<?php
// Pure business logic for the "Change Discount Type" flow (PWD/Senior
// Citizen switch, reached only once a commuter's current discount category
// has expired — see api/auth/commuter_switch_category.php). Reuses every
// OCR/fuzzy-match primitive from config/student_verification.php verbatim
// (they're already generic despite that file's name) rather than
// duplicating them — this file only adds what's genuinely new: a
// three-outcome classifier (verified / uncertain / rejected) instead of the
// Student pipeline's binary pass/fail, and the Senior-only birthdate/age
// check. No academic-period equivalent exists here — PWD/Senior status has
// no term/semester concept to validate against.
require_once __DIR__ . "/student_verification.php";

// Face-match band, specific to this flow (the Student pipeline only ever
// used FACE_MATCH_MIN_SIMILARITY as a hard pass/fail line — this flow adds a
// second, higher line so a "technically above 80 but not by much" result
// falls to manual review instead of auto-verifying).
define('CATEGORY_SWITCH_FACE_MATCH_CLEAR_PASS', 92.0);

/**
 * Senior Citizen only — checks whether the typed birthdate is confirmable on
 * the OCR'd document (tried across a handful of common printed date
 * formats, since there's no way to know which one a given ID uses) and
 * computes the resulting age. Returns ['found'=>bool, 'age'=>int|null].
 * $birthdate must be 'Y-m-d' (what an HTML/RN date picker naturally emits).
 */
function checkSeniorAge(string $birthdate, string $ocrText): array {
    $dt = DateTime::createFromFormat('Y-m-d', $birthdate);
    if (!$dt) {
        return ['found' => false, 'age' => null];
    }
    $age = (new DateTime())->diff($dt)->y;

    $candidates = [
        $dt->format('m/d/Y'), $dt->format('m-d-Y'), $dt->format('d/m/Y'),
        $dt->format('Y-m-d'), $dt->format('M d, Y'), $dt->format('F d, Y'),
    ];
    foreach ($candidates as $candidate) {
        if (ocrContainsNormalized($candidate, $ocrText)) {
            return ['found' => true, 'age' => $age];
        }
    }
    return ['found' => false, 'age' => $age];
}

/**
 * PWD only — checks whether the typed Validity Date is confirmable on the
 * OCR'd document (same multi-format-candidate approach as checkSeniorAge())
 * and whether it's already in the past relative to today. Returns
 * ['found'=>bool, 'expired'=>bool]. $validityDate must be 'Y-m-d'. Unlike
 * checkSeniorAge()'s age (which only matters once confirmed on the
 * document), 'expired' is computed unconditionally — a confirmed-expired ID
 * is a hard block regardless of what the OCR search finds, so the caller
 * needs the expiry fact even when 'found' is false.
 *
 * Expiry is same-day-inclusive (validity_date == today is still valid, only
 * the day after is expired) — matches the worked examples used to design
 * this feature and the expires_at storage convention (validity_date stored
 * as "{validity_date} 23:59:59", see commuter_register_pwd.php).
 */
function checkPwdValidity(string $validityDate, string $ocrText): array {
    $dt = DateTime::createFromFormat('Y-m-d', $validityDate);
    if (!$dt) {
        return ['found' => false, 'expired' => false];
    }
    $today = new DateTime('today');
    $expired = $dt < $today;

    $candidates = [
        $dt->format('m/d/Y'), $dt->format('m-d-Y'), $dt->format('d/m/Y'),
        $dt->format('Y-m-d'), $dt->format('M d, Y'), $dt->format('F d, Y'),
    ];
    foreach ($candidates as $candidate) {
        if (ocrContainsNormalized($candidate, $ocrText)) {
            return ['found' => true, 'expired' => $expired];
        }
    }
    return ['found' => false, 'expired' => $expired];
}

/**
 * The single dispatcher for this flow's three-outcome result. Unlike the
 * Student pipeline (which respondFail()s immediately on the first failed
 * check), this runs every applicable check and only resolves the final
 * outcome once all of them have reported in — a "rejected" signal from any
 * one check always wins over an "uncertain" one from another, since a
 * confident fraud/ineligibility finding should never be softened into "let
 * an admin look at it" just because an unrelated check was merely
 * inconclusive. Liveness is NOT handled here — it's checked earlier in the
 * endpoint via the existing checkPoseChallenge(), exactly like the Student
 * pipeline, since a failed liveness capture is always an immediate,
 * unambiguous retake — there's no "uncertain" liveness result to weigh here.
 *
 * $fields: ['lastName'=>string, 'firstName'=>string, 'idNumber'=>string, 'birthdate'=>?string]
 * $faceMatch: the raw return of rekognitionCompareFaces() — its 'similarity'
 * is read directly here (banded into three tiers) rather than just its
 * pre-thresholded 'success' boolean.
 *
 * The 'rejected' vs 'uncertain' distinction is purely internal/audit — both
 * are treated identically by the calling endpoint (fall through to the
 * admin's manual-review queue, never a hard block). It's kept here anyway
 * because it's still useful to know, for the audit trail and any future
 * admin-facing detail view, WHICH kind of finding triggered the review: a
 * confident one (wrong ID number, under-60 age) vs. a merely inconclusive
 * one (fuzzy name miss, mid-band face-match).
 *
 * 'blocked' is different — it's the one outcome the endpoint must still
 * treat as an immediate hard reject, no account created. Three findings
 * cause it: (a) a face-match similarity confidently below
 * FACE_MATCH_HARD_REJECT_BELOW — that's not "OCR couldn't read something
 * clearly," it's Rekognition confidently reporting these are two different
 * people, someone else's ID plus the applicant's own face, i.e. the exact
 * impersonation this whole pipeline exists to catch; (b), Senior Citizen
 * only, an OCR-confirmed birthdate showing age < 60; and (c), PWD only, an
 * OCR-confirmed Validity Date already in the past — eligibility is a hard
 * requirement for these discounts, not a judgment call an admin should have
 * to make, so unlike a name mismatch or a mid-band face-match none of these
 * are ever softened into manual review. All three cases mean an account would otherwise
 * eligible/legitimate to begin with. Liveness failures are a third hard-
 * block case, but those are checked outside this function (in the endpoint,
 * via checkPoseChallenge()) since a bad capture has no similarity score to
 * classify in the first place.
 *
 * Returns ['outcome'=>'verified'|'uncertain'|'rejected'|'blocked', 'stage'=>?string, 'message'=>string].
 */
function classifySwitchVerification(
    string $category, array $fields, string $ocrText, bool $ocrRan, array $faceMatch
): array {
    $blocked   = null; // ['stage','message'] — confident impersonation finding, always hard-rejected, never wins
    $rejected  = null; // ['stage','message'] — set by a confident fraud/ineligibility finding
    $uncertain = null; // ['stage','message'] — set by an inconclusive finding, never overwritten once set

    if (!$ocrRan) {
        // Tesseract isn't installed on this server — deliberately treated as
        // "uncertain" here, NOT a soft-pass like the Student pipeline. That
        // divergence is intentional: this flow's whole premise is "automatic
        // unless something couldn't be confirmed," and "OCR never ran at
        // all" is exactly that — there's nothing to have passed.
        $uncertain = ['stage' => 'ocr', 'message' => "We couldn't run automatic document verification on your captured photos."];
    } else {
        if (!ocrContainsIdNumber($fields['idNumber'], $ocrText)) {
            // Exact-match only, same discipline as the Student pipeline's
            // hardened ocrContainsIdNumber() — an ID-number mismatch is a
            // confident fraud/duplicate-account signal, not a "maybe OCR
            // misread it" case, so it's always rejected, never uncertain.
            $rejected = ['stage' => 'ocr', 'message' => "We couldn't find your ID number on the captured photos. Please double check the number you typed and retake the ID photos."];
        }
        if (!$rejected && !$uncertain && !fuzzyNameMatch($fields['lastName'], $fields['firstName'], $ocrText)) {
            $uncertain = ['stage' => 'ocr', 'message' => "We couldn't confidently confirm your name on the captured ID."];
        }
        if ($category === 'elderly') {
            $seniorCheck = checkSeniorAge($fields['birthdate'] ?? '', $ocrText);
            if (!$seniorCheck['found']) {
                if (!$rejected && !$uncertain) {
                    $uncertain = ['stage' => 'ocr', 'message' => "We couldn't confirm your birthdate on the captured ID."];
                }
            } elseif ($seniorCheck['age'] !== null && $seniorCheck['age'] < 60 && !$blocked) {
                // Hard block, not "rejected" (which still falls through to
                // admin review elsewhere in this function) — a confirmed
                // under-60 age is a strict eligibility gate for this
                // discount, not an inconclusive finding for a human to
                // weigh. `!$blocked` guard: on the off chance a future check
                // added above this one also sets $blocked, first reason wins
                // (matches this function's existing $uncertain/$rejected
                // "never overwritten once set" convention).
                $blocked = ['stage' => 'details', 'message' => "Based on the birthdate on your ID, you don't meet the minimum age (60) required for the Senior Citizen discount."];
            }
        } elseif ($category === 'disabled') {
            $pwdCheck = checkPwdValidity($fields['validityDate'] ?? '', $ocrText);
            if (!$pwdCheck['found']) {
                if (!$rejected && !$uncertain) {
                    $uncertain = ['stage' => 'ocr', 'message' => "We couldn't confirm your ID's Validity Date on the captured document."];
                }
            } elseif ($pwdCheck['expired'] && !$blocked) {
                // Hard block, same reasoning as the Senior age check above —
                // a confirmed-expired Validity Date is a strict eligibility
                // gate (the physical ID itself is no longer valid), not an
                // inconclusive finding for a human to weigh.
                $blocked = ['stage' => 'details', 'message' => "Your PWD ID's validity date has already passed. Please renew your physical ID with your issuing office before registering."];
            }
        }
    }

    $similarity = $faceMatch['similarity'] ?? null;
    if ($similarity === null) {
        // Couldn't even run the comparison (missing/corrupt image, or a
        // technical Rekognition error) — an inability to check, not a
        // confirmed mismatch, so this is uncertain rather than blocked.
        if (!$rejected && !$uncertain) {
            $uncertain = ['stage' => 'face_match', 'message' => "We couldn't confidently verify your selfie against your ID photo."];
        }
    } elseif ($similarity < FACE_MATCH_HARD_REJECT_BELOW && $category !== 'elderly' && !$blocked) {
        // Guarded the same way as the age check above — if the age check
        // already blocked this submission, that reason wins; no need to
        // overwrite it with a second, unrelated blocked finding.
        //
        // Senior Citizen is deliberately exempt from this hard-block tier —
        // unlike PWD, a Senior's own ID is never renewed/reissued (it never
        // expires, see the schema note on commuter_id_verifications.expires_at),
        // so the photo on it can be decades old, and an elderly applicant's
        // face naturally changes more over that span than a working-age
        // adult's would. A confidently low score here is still a real signal
        // worth a human looking at, just not one this pipeline should ever
        // auto-reject on by itself — so for 'elderly' this falls straight
        // through to the ordinary "< FACE_MATCH_MIN_SIMILARITY" branch below
        // instead, which lands on 'rejected' (account still created,
        // pending_review, sent to the admin queue) no matter how low the
        // percentage is.
        $blocked = ['stage' => 'face_match', 'message' => "Your selfie doesn't resemble your ID photo at all ({$similarity}% similarity). This looks like it may not be your own ID — please make sure you're using your own ID and your own face."];
    } elseif ($similarity < FACE_MATCH_MIN_SIMILARITY) {
        $rejected = ['stage' => 'face_match', 'message' => $faceMatch['error'] ?? "Your selfie doesn't match your ID photo closely enough."];
    } elseif ($similarity < CATEGORY_SWITCH_FACE_MATCH_CLEAR_PASS) {
        if (!$rejected && !$uncertain) {
            $uncertain = ['stage' => 'face_match', 'message' => "Your selfie match wasn't conclusive enough for automatic approval."];
        }
    }

    if ($blocked) {
        return ['outcome' => 'blocked', 'stage' => $blocked['stage'], 'message' => $blocked['message']];
    }
    if ($rejected) {
        return ['outcome' => 'rejected', 'stage' => $rejected['stage'], 'message' => $rejected['message']];
    }
    if ($uncertain) {
        return ['outcome' => 'uncertain', 'stage' => $uncertain['stage'], 'message' => $uncertain['message'] . " Your submission has been sent to an admin for manual review — you'll be notified once it's decided."];
    }
    return ['outcome' => 'verified', 'stage' => null, 'message' => "You're verified."];
}
