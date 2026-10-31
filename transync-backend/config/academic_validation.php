<?php
require_once __DIR__ . "/student_verification.php";

// Reusable academic-period validation service — K-12 and College have
// genuinely different calendars (K-12: one continuous year-long term;
// College: three distinct semesters, each with its own boundary), so they're
// kept as separate functions rather than one shared rule with special cases.
// Every date comparison here uses PHP's own clock via `new DateTime()` (item
// 10: "no hardcoded years, always use the server's current date") — unlike
// the grace-period/quota-reset code elsewhere in this app, this is
// deliberately NOT run through the DB-clock dance documented as the
// PHP/MySQL timezone-mismatch landmine: that landmine only matters for
// same-day, hour/minute-level comparisons, and every boundary here is a
// calendar month apart, so a several-hour clock skew can never flip the
// result.

// Semester is never captured from the commuter or the document anymore —
// it's derived purely from the server clock (currentCollegeBucket()) and
// used only to compute the right expiry boundary (see
// currentAcademicYearSuggestion()/validateCollegePeriod() below). Since
// it's no longer a claim anyone makes, there's nothing to OCR-cross-check
// or ask the commuter to confirm — that whole surface (the OCR phrase list,
// the "please select your semester" validation, the "on your ID" cross-
// check) was removed on request, along with the wizard's Semester picker.

function parseAcademicYear(string $academicYear): ?array {
    if (!preg_match('/^(\d{4})\s*-\s*(\d{4})$/', trim($academicYear), $m)) return null;
    $y1 = (int)$m[1];
    $y2 = (int)$m[2];
    if ($y2 !== $y1 + 1) return null;
    return [$y1, $y2];
}

function ocrContainsAcademicYear(string $academicYear, string $ocrText): bool {
    return ocrContainsNormalized($academicYear, $ocrText);
}

/**
 * K-12 runs one continuous term, June(Y1) through March(Y2) — confirmed
 * against the source spec's own worked example ("Valid period: June 2025 …
 * March 2026"). April/May of Y2 is a dead zone: the old term has ended and
 * the next one hasn't begun, so a K-12 ID is NOT valid then either — this
 * was a deliberate, explicitly-confirmed reading of an otherwise ambiguous
 * spec (the alternative "valid until the next year begins in June" was
 * rejected).
 */
function validateK12Period(int $y1, int $y2, DateTime $asOf): array {
    $start = new DateTime("{$y1}-06-01 00:00:00");
    $end   = new DateTime("{$y2}-03-31 23:59:59");
    if ($asOf >= $start && $asOf <= $end) {
        return ['valid' => true, 'message' => null, 'expires_at' => $end];
    }
    return [
        'valid' => false,
        'message' => 'Your Student ID or Enrollment Form has expired. Please upload a document for the current academic year.',
        'expires_at' => null,
    ];
}

/**
 * College has three distinct terms per academic year — First Semester
 * (Aug-Dec of Y1), Second Semester (Jan-May of Y2), Midyear (Jun-Jul of
 * Y2) — validated as an exact range match against the claimed
 * (academic_year, semester) pair, no grace period (per the source spec's
 * four worked examples, all of which flip to invalid the instant the next
 * term's range begins).
 */
function collegeSemesterRange(int $y1, int $y2, string $semester): array {
    switch ($semester) {
        case '1st':     return [new DateTime("{$y1}-08-01 00:00:00"), new DateTime("{$y1}-12-31 23:59:59")];
        case '2nd':     return [new DateTime("{$y2}-01-01 00:00:00"), new DateTime("{$y2}-05-31 23:59:59")];
        case 'midyear': return [new DateTime("{$y2}-06-01 00:00:00"), new DateTime("{$y2}-07-31 23:59:59")];
        default: throw new \InvalidArgumentException("Unknown semester: {$semester}");
    }
}

/** Which academic-year+semester bucket a given date falls into — used only
 * to build a human "the current term is X" message, independent of whether
 * any particular claimed period is valid. */
function currentCollegeBucket(DateTime $asOf): array {
    $year  = (int)$asOf->format('Y');
    $month = (int)$asOf->format('n');
    if ($month >= 8) return [$year, $year + 1, '1st'];
    if ($month <= 5) return [$year - 1, $year, '2nd'];
    return [$year - 1, $year, 'midyear']; // June-July
}

/**
 * Which K-12 academic year a given date suggests — used only to auto-fill
 * the wizard's (now read-only) Academic Year field, never as a validity
 * check itself. Note April/May has no AY that would actually pass
 * validateK12Period() (see that function's own comment) — this still
 * returns the most recently-started year as the least-wrong default to
 * show, since the rejection message explains why either way.
 */
function currentK12Bucket(DateTime $asOf): array {
    $year  = (int)$asOf->format('Y');
    $month = (int)$asOf->format('n');
    return $month >= 6 ? [$year, $year + 1] : [$year - 1, $year];
}

/**
 * What the wizard should auto-fill for Academic Year (+ Semester default,
 * College only) based purely on today's date — the single source of truth
 * for "auto-detect the current A.Y." so the client never computes this
 * independently and risks drifting from what validateAcademicPeriod()
 * itself would accept.
 */
function currentAcademicYearSuggestion(string $idType, ?DateTime $asOf = null): array {
    $asOf = $asOf ?? new DateTime();
    if ($idType === 'k12') {
        [$y1, $y2] = currentK12Bucket($asOf);
        return ['academic_year' => "{$y1}-{$y2}", 'semester' => null];
    }
    [$y1, $y2, $sem] = currentCollegeBucket($asOf);
    return ['academic_year' => "{$y1}-{$y2}", 'semester' => $sem];
}

/**
 * The "Missing Information Rule": whether the claimed Academic Year can
 * actually be confirmed on the OCR'd document text — the trigger for
 * automatically requiring an Enrollment Form/COE, replacing the old manual
 * "does your ID show a validity date?" question. Semester is deliberately
 * not checked here (or anywhere) — it's never a claim the commuter or the
 * document makes anymore, only a server-derived value (see
 * validateCollegePeriod()). Name/Student ID number stay separate final-
 * submission checks, unaffected by this rule.
 * Returns ['sufficient'=>bool, 'missing'=>string[]].
 */
function checkRequiredDetailsOnDocument(string $academicYear, string $ocrText): array {
    $missing = ocrContainsAcademicYear($academicYear, $ocrText) ? [] : ['academic_year'];
    return ['sufficient' => empty($missing), 'missing' => $missing];
}

/**
 * College's semester is always "whichever one the server clock says is
 * current right now" (currentCollegeBucket()) — never a claim from the
 * commuter or the document, so this only ever fails when the claimed
 * Academic Year itself doesn't match the current one (the current
 * semester's range, by construction, always contains "now" — see
 * currentCollegeBucket()'s own derivation).
 */
function validateCollegePeriod(int $y1, int $y2, DateTime $asOf): array {
    [$curY1, $curY2, $curSem] = currentCollegeBucket($asOf);
    [$start, $end] = collegeSemesterRange($curY1, $curY2, $curSem);
    if ($y1 === $curY1 && $y2 === $curY2) {
        return ['valid' => true, 'message' => null, 'expires_at' => $end];
    }
    return [
        'valid' => false,
        'message' => "Your Student ID or Enrollment Form is for academic year {$y1}-{$y2}, but the current academic year is {$curY1}-{$curY2}. Please upload a document for the current academic year.",
        'expires_at' => null,
    ];
}

/**
 * Dispatcher — the one entry point commuter_register_student.php /
 * commuter_renew_student.php should call. $asOf is injectable for testing
 * (see tests/academic_validation_test.php); production callers always leave
 * it null (defaults to the real server clock).
 * Returns ['valid'=>bool, 'message'=>string|null, 'expires_at'=>DateTime|null].
 */
function validateAcademicPeriod(string $idType, string $academicYear, ?DateTime $asOf = null): array {
    $asOf = $asOf ?? new DateTime();
    $years = parseAcademicYear($academicYear);
    if (!$years) {
        return ['valid' => false, 'message' => 'Please enter your academic year in the format 2025-2026.', 'expires_at' => null];
    }
    [$y1, $y2] = $years;
    return $idType === 'k12'
        ? validateK12Period($y1, $y2, $asOf)
        : validateCollegePeriod($y1, $y2, $asOf);
}
