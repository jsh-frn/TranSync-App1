<?php
// Pure business logic for the Student ID verification pipeline — no
// network calls (see config/rekognition.php for the vendor face-match/
// liveness calls). OCR here is Tesseract, run locally as a system binary:
// free, real, no account/API key, works offline. Student IDs aren't a
// standardized document type (every school designs its own layout), so a
// specialized "ID document" model would perform badly here regardless of
// budget — generic text extraction + our own matching against what the
// commuter typed is the right shape of solution either way.

define('TESSERACT_BINARY', 'tesseract');

/**
 * True if the `tesseract` binary is reachable on PATH. If not, OCR
 * cross-checking soft-skips (see runTesseractOcr()) rather than blocking
 * registration — keeps the rest of the pipeline demoable on a machine that
 * hasn't installed Tesseract yet.
 */
function isTesseractAvailable(): bool {
    static $available = null;
    if ($available === null) {
        // Must check the exit code, not just grep the output for the word
        // "tesseract" — on Windows, cmd.exe's own "not recognized" error for
        // a missing binary echoes the failed command name right back
        // ("'tesseract' is not recognized as an internal or external
        // command..."), which contains "tesseract" and would false-positive
        // as "installed". Confirmed live: this exact false positive made
        // the OCR stage run (and fail) instead of soft-skipping on a
        // machine with no Tesseract install.
        @exec(escapeshellarg(TESSERACT_BINARY) . ' --version 2>&1', $out, $returnCode);
        $available = $returnCode === 0;
    }
    return $available;
}

/**
 * Runs Tesseract OCR against one captured image.
 * Returns ['success'=>bool, 'text'=>string|null, 'skipped'=>bool, 'error'=>string|null].
 * 'skipped' true means the binary wasn't found — caller should soft-pass
 * whatever check depended on this rather than hard-failing the commuter.
 *
 * ID cards are dense, small, scattered text — not the single uniform block
 * of prose Tesseract's default page-segmentation mode (PSM) assumes. Runs
 * both PSM 6 (uniform block) and PSM 11 (sparse text, no layout assumption)
 * and merges their output — different modes catch different layouts, and a
 * second OCR pass is cheap next to the cost of rejecting a genuinely clear,
 * correctly-typed document (a real reported failure this was written to fix).
 */
function runTesseractOcr(string $imagePath): array {
    if (!isTesseractAvailable()) {
        return ['success' => false, 'text' => null, 'skipped' => true, 'error' => 'Tesseract OCR is not installed on this server.'];
    }
    if (!is_file($imagePath)) {
        return ['success' => false, 'text' => null, 'skipped' => false, 'error' => 'Image file not found.'];
    }

    $combined = '';
    foreach ([6, 11] as $psm) {
        $text = runTesseractPass($imagePath, $psm);
        if ($text !== null) $combined .= "\n" . $text;
    }

    if ($combined === '') {
        return ['success' => false, 'text' => null, 'skipped' => false, 'error' => 'OCR produced no output.'];
    }
    return ['success' => true, 'text' => $combined, 'skipped' => false, 'error' => null];
}

function runTesseractPass(string $imagePath, int $psm): ?string {
    $outBase = tempnam(sys_get_temp_dir(), 'ocr_');
    @unlink($outBase); // tesseract appends .txt itself; we just need a unique base path
    $cmd = escapeshellarg(TESSERACT_BINARY) . ' ' . escapeshellarg($imagePath) . ' ' . escapeshellarg($outBase) . " --psm {$psm} 2>&1";
    @shell_exec($cmd);

    $txtPath = $outBase . '.txt';
    if (!is_file($txtPath)) return null;
    $text = file_get_contents($txtPath);
    @unlink($txtPath);
    return $text ?: null;
}

function normalizeForMatch(string $s): string {
    $s = strtoupper($s);
    $s = preg_replace('/[^A-Z0-9]+/', ' ', $s);
    return trim(preg_replace('/\s+/', ' ', $s));
}

/**
 * Tolerant of the single most common Tesseract failure mode on ID-card text
 * — a lone misread character (0/O, 1/I/l, 5/S, 8/B, etc.) — which an exact
 * substring match rejects outright even when the document is genuinely
 * clear and correctly typed (a real reported failure: a plainly-printed ID
 * number came back "not found"). $token must be a single word/run with no
 * internal spaces; $haystackTokens is the space-split, normalized OCR text.
 */
function containsFuzzyToken(string $token, array $haystackTokens, int $maxDistance): bool {
    if (in_array($token, $haystackTokens, true)) return true; // fast exact path
    foreach ($haystackTokens as $h) {
        if (abs(strlen($h) - strlen($token)) > $maxDistance) continue; // skip tokens that can't possibly be within distance
        if (levenshtein($h, $token) <= $maxDistance) return true;
    }
    return false;
}

/** 1-character tolerance for anything 4+ characters (covers common 4-letter
 * name parts like "DELA"/"CRUZ"/"JUAN"); shorter values stay exact-match,
 * since a 1-char edit distance on something that short risks matching
 * almost anything nearby. */
function fuzzyTolerance(string $normalizedWord): int {
    return strlen($normalizedWord) >= 4 ? 1 : 0;
}

/**
 * True if every word of $phrase fuzzy-matches some token in
 * $haystackTokens, in any order — the shared primitive behind
 * fuzzyNameMatch() and fuzzySchoolMatch() below. Generic OCR returns
 * unordered, sometimes-misread text, so this is a fuzzy per-word token
 * check, not a structured field extraction — flagged as a known
 * limitation, not a bug.
 */
function fuzzyPhraseMatch(string $phrase, array $haystackTokens): bool {
    $phraseNorm = normalizeForMatch($phrase);
    if ($phraseNorm === '') return false;
    foreach (preg_split('/\s+/', $phraseNorm) as $word) {
        if ($word === '') continue;
        if (!containsFuzzyToken($word, $haystackTokens, fuzzyTolerance($word))) return false;
    }
    return true;
}

/**
 * Best-effort check that the typed last/first name both appear somewhere in
 * the OCR'd document text. Every word of both names (handles multi-word
 * names like "Dela Cruz") must fuzzy-match some token, in any order — OCR
 * can reorder/split lines.
 */
function fuzzyNameMatch(string $lastName, string $firstName, string $ocrText): bool {
    $haystackTokens = preg_split('/\s+/', trim(normalizeForMatch($ocrText)));
    return fuzzyPhraseMatch($lastName, $haystackTokens) && fuzzyPhraseMatch($firstName, $haystackTokens);
}

/**
 * Same idea as fuzzyNameMatch(), for the typed School Name — the ID/
 * Enrollment Form's own printed school name must fuzzy-match, word for
 * word, so a genuinely different or mistyped school can't slip through.
 */
function fuzzySchoolMatch(string $schoolName, string $ocrText): bool {
    $haystackTokens = preg_split('/\s+/', trim(normalizeForMatch($ocrText)));
    return fuzzyPhraseMatch($schoolName, $haystackTokens);
}

/**
 * Fuzzy substring presence check for a contiguous code (ID number, academic
 * year) — spaces are stripped from both sides before comparing (IDs are
 * printed without spaces; OCR sometimes inserts spurious ones from font
 * kerning), then every equal-length window of the haystack is compared by
 * edit distance. $maxDistance=0 means exact-match only.
 */
function ocrContainsFuzzy(string $needle, string $ocrText, int $maxDistance): bool {
    $needleNorm = str_replace(' ', '', normalizeForMatch($needle));
    if ($needleNorm === '') return false;
    $haystack = str_replace(' ', '', normalizeForMatch($ocrText));
    $len  = strlen($needleNorm);
    $hLen = strlen($haystack);
    if ($hLen < $len) return false;

    if ($maxDistance === 0) return str_contains($haystack, $needleNorm);

    for ($i = 0; $i <= $hLen - $len; $i++) {
        if (levenshtein(substr($haystack, $i, $len), $needleNorm) <= $maxDistance) return true;
    }
    return false;
}

/**
 * Generic normalized-with-tolerance substring presence check — the shared
 * primitive behind lower-stakes "does this typed value actually appear on
 * the OCR'd document" checks (currently just academic year, see
 * config/academic_validation.php). NOT used for the Student ID Number —
 * see ocrContainsIdNumber()'s own note for why that one is deliberately
 * exact-only.
 */
function ocrContainsNormalized(string $needle, string $ocrText): bool {
    return ocrContainsFuzzy($needle, $ocrText, fuzzyTolerance(str_replace(' ', '', normalizeForMatch($needle))));
}

/**
 * Deliberately EXACT match (no Levenshtein tolerance), unlike name/school/
 * academic-year — the Student ID Number is the field that gates duplicate-
 * account prevention (see the UNIQUE-scoped lookup in
 * commuter_register_student.php), so tolerating a 1-character difference
 * doesn't just risk misreading a genuinely correct document, it directly
 * defeats that anti-fraud check: confirmed live, typing 0123300013 against
 * a real ID reading 0123300011 wrongly passed under the old fuzzy version.
 * Still benefits from normalizeForMatch's space-stripping (OCR font-kerning
 * artifacts can insert spurious spaces), just no character-level tolerance.
 */
function ocrContainsIdNumber(string $idNumber, string $ocrText): bool {
    return ocrContainsFuzzy($idNumber, $ocrText, 0);
}

// isAcademicYearCurrent()/computeExpiryDate() (the original flat "generous
// June-August window" / "+10mo or +5mo from verified_at" versions) are
// superseded by config/academic_validation.php's precise K-12/College rules
// — removed rather than deprecated-in-place, since they were added this
// same session with exactly two callers, both updated alongside this.

/**
 * The pose-challenge liveness check: verifies three captured stills
 * (center / turned left / turned right, each already run through
 * rekognitionDetectFaces()) show one real face genuinely turning on
 * command. This proves motion happened on command — it is NOT
 * presentation-attack detection (see the plan's explicit limitation note);
 * a video replay of someone turning their head could still pass. In demo
 * mode (no AWS keys configured) it only confirms three distinct real images
 * were captured, since simulating pose direction without real ML would be
 * dishonest.
 * Returns ['success'=>bool, 'error'=>string|null].
 */
function checkPoseChallenge(array $center, array $left, array $right): array {
    foreach (['center' => $center, 'left' => $left, 'right' => $right] as $label => $frame) {
        if (empty($frame['face_found'])) {
            return ['success' => false, 'error' => "We couldn't detect a face in your \"{$label}\" photo. Please retake it."];
        }
    }

    $provider = $center['provider'] ?? 'demo';
    if ($provider === 'demo') {
        return ['success' => true, 'error' => null];
    }

    $centerYaw = (float)($center['yaw'] ?? 0);
    $leftYaw   = (float)($left['yaw'] ?? 0);
    $rightYaw  = (float)($right['yaw'] ?? 0);

    if (abs($centerYaw) > POSE_MIN_YAW_DEGREES) {
        return ['success' => false, 'error' => 'Please look straight at the camera for the center photo, then retake all three.'];
    }
    // Rekognition's Pose.Yaw sign convention: negative = turned toward the
    // camera's left, positive = turned toward the camera's right (or vice
    // versa depending on capture orientation) — what matters here is that
    // the two turn photos moved a meaningful amount in opposite directions.
    if (abs($leftYaw) < POSE_MIN_YAW_DEGREES || abs($rightYaw) < POSE_MIN_YAW_DEGREES) {
        return ['success' => false, 'error' => "We couldn't detect enough head movement in your turn photos. Please turn further and retake."];
    }
    if (($leftYaw > 0) === ($rightYaw > 0)) {
        return ['success' => false, 'error' => 'Your left and right turn photos look like the same direction. Please retake them.'];
    }

    return ['success' => true, 'error' => null];
}
