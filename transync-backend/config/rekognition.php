<?php
// Face-match + pose-challenge liveness provider for the Student ID
// verification pipeline (config/student_verification.php holds the
// non-vendor business logic; api/auth/commuter_register_student.php is
// where these get called). Demo-mode-by-default, matching this codebase's
// existing GCash/Maya "(Demo)" convention (Core Flow 15a) — with no AWS
// credentials configured below, every function here returns a clearly
// synthetic result instead of failing, so the whole verification flow stays
// demoable without a paid AWS account. Drop real credentials into
// transync-backend/.env (gitignored, see .env.example) to flip to real
// Rekognition calls with no changes anywhere else in the codebase — never
// hardcode a real key here, this file is not a secret store.

require_once __DIR__ . '/env.php';

define('AWS_REKOGNITION_ACCESS_KEY', getenv('AWS_REKOGNITION_ACCESS_KEY') ?: '');
define('AWS_REKOGNITION_SECRET_KEY', getenv('AWS_REKOGNITION_SECRET_KEY') ?: '');
define('AWS_REKOGNITION_REGION', getenv('AWS_REKOGNITION_REGION') ?: 'ap-southeast-1');

// Single-file AWS SDK, no Composer/autoloader — download from
// https://docs.aws.amazon.com/sdk-for-php/v3/developer-guide/getting-started_phar.html
// and place it at this path.
define('AWS_SDK_PHAR_PATH', dirname(__DIR__) . '/vendor/aws.phar');

define('FACE_MATCH_MIN_SIMILARITY', 80.0); // percent, CompareFaces threshold
define('POSE_MIN_YAW_DEGREES', 15.0);      // minimum head-turn to count as a real turn

// Below this similarity, Rekognition isn't just "not confident enough for
// an automatic pass" — it's confident these are two different people. That
// distinction matters for the Student/PWD/Senior verification pipelines
// (config/student_verification.php's callers, config/discount_switch_validation.php):
// a score in the 50-80 band is treated as an inconclusive/photo-quality
// case that still goes to a human for review, but anything below this line
// is treated as confirmed impersonation (someone else's ID + the
// applicant's own face) and hard-blocks immediately — never softened into
// "let an admin decide," since there's nothing ambiguous about it.
define('FACE_MATCH_HARD_REJECT_BELOW', 50.0);

function isVerificationLive(): bool {
    return AWS_REKOGNITION_ACCESS_KEY !== ''
        && AWS_REKOGNITION_SECRET_KEY !== ''
        && file_exists(AWS_SDK_PHAR_PATH);
}

function getRekognitionClient() {
    static $client = null;
    if ($client === null) {
        require_once AWS_SDK_PHAR_PATH;
        $client = new Aws\Rekognition\RekognitionClient([
            'version'     => 'latest',
            'region'      => AWS_REKOGNITION_REGION,
            'credentials' => [
                'key'    => AWS_REKOGNITION_ACCESS_KEY,
                'secret' => AWS_REKOGNITION_SECRET_KEY,
            ],
        ]);
    }
    return $client;
}

/**
 * Compare a live selfie against the captured ID front photo (1:1 match).
 * Returns ['success'=>bool, 'similarity'=>float|null, 'provider'=>string, 'error'=>string|null].
 */
function rekognitionCompareFaces(string $selfiePath, string $idFrontPath): array {
    if (!isVerificationLive()) {
        // DEMO MODE: no real face-match performed. Synthetic pass, unless a
        // file is genuinely missing/empty (still catches a broken upload).
        if (!is_file($selfiePath) || !is_file($idFrontPath) || filesize($selfiePath) === 0 || filesize($idFrontPath) === 0) {
            return ['success' => false, 'similarity' => null, 'provider' => 'demo', 'error' => 'Image file missing or empty.'];
        }
        return ['success' => true, 'similarity' => 96.5, 'provider' => 'demo', 'error' => null];
    }

    try {
        $client = getRekognitionClient();
        $result = $client->compareFaces([
            'SourceImage'         => ['Bytes' => file_get_contents($selfiePath)],
            'TargetImage'         => ['Bytes' => file_get_contents($idFrontPath)],
            'SimilarityThreshold' => 0,
        ]);
        $matches = $result->get('FaceMatches') ?: [];
        if (empty($matches)) {
            return ['success' => false, 'similarity' => 0.0, 'provider' => 'aws_rekognition', 'error' => 'No matching face found between your selfie and ID photo.'];
        }
        $similarity = (float)$matches[0]['Similarity'];
        $pass = $similarity >= FACE_MATCH_MIN_SIMILARITY;
        return [
            'success'    => $pass,
            'similarity' => $similarity,
            'provider'   => 'aws_rekognition',
            'error'      => $pass ? null : "Your selfie doesn't match your ID photo closely enough ({$similarity}% similarity).",
        ];
    } catch (\Throwable $e) {
        return ['success' => false, 'similarity' => null, 'provider' => 'aws_rekognition', 'error' => 'Face-match service error: ' . $e->getMessage()];
    }
}

/**
 * Detect a single face's pose/eyes attributes in one image — feeds the
 * pose-challenge liveness check (checkPoseChallenge() in
 * config/student_verification.php), not a general-purpose face detector.
 * Returns ['success'=>bool, 'face_found'=>bool, 'yaw'=>float|null, 'eyes_open'=>bool|null, 'provider'=>string, 'error'=>string|null].
 */
function rekognitionDetectFaces(string $imagePath): array {
    if (!isVerificationLive()) {
        // DEMO MODE: no real pose/eyes detection — this function cannot
        // honestly simulate WHICH direction a face is turned without real
        // ML, so it always reports "face found, centered, eyes open" as
        // long as a real image file was actually captured. The
        // pose-challenge check's demo branch only verifies that three
        // distinct images exist, not their pose content.
        if (!is_file($imagePath) || filesize($imagePath) === 0) {
            return ['success' => false, 'face_found' => false, 'yaw' => null, 'eyes_open' => null, 'provider' => 'demo', 'error' => 'Image file missing or empty.'];
        }
        return ['success' => true, 'face_found' => true, 'yaw' => 0.0, 'eyes_open' => true, 'provider' => 'demo', 'error' => null];
    }

    try {
        $client = getRekognitionClient();
        $result = $client->detectFaces([
            'Image'      => ['Bytes' => file_get_contents($imagePath)],
            'Attributes' => ['ALL'],
        ]);
        $details = $result->get('FaceDetails') ?: [];
        if (empty($details)) {
            return ['success' => false, 'face_found' => false, 'yaw' => null, 'eyes_open' => null, 'provider' => 'aws_rekognition', 'error' => 'No face detected in image.'];
        }
        $face = $details[0];
        return [
            'success'    => true,
            'face_found' => true,
            'yaw'        => (float)($face['Pose']['Yaw'] ?? 0),
            'eyes_open'  => (bool)($face['EyesOpen']['Value'] ?? true),
            'provider'   => 'aws_rekognition',
            'error'      => null,
        ];
    } catch (\Throwable $e) {
        return ['success' => false, 'face_found' => false, 'yaw' => null, 'eyes_open' => null, 'provider' => 'aws_rekognition', 'error' => 'Face-detect service error: ' . $e->getMessage()];
    }
}
