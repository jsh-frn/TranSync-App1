<?php
// Standalone CLI test script — this codebase has no test framework/Composer
// (confirmed, no composer.json anywhere), so this matches its existing
// zero-dependency convention rather than introducing PHPUnit for one file.
// Run: php tests/academic_validation_test.php
require_once __DIR__ . "/../config/academic_validation.php";

$failures = 0;
$total    = 0;

function check(string $label, bool $condition): void {
    global $failures, $total;
    $total++;
    if ($condition) {
        echo "PASS: {$label}\n";
    } else {
        echo "FAIL: {$label}\n";
        $failures++;
    }
}

function d(string $s): DateTime {
    return new DateTime($s);
}

// ── K-12 ──────────────────────────────────────────────────────────────────
// Doc's own worked example: AY 2025-2026, current Aug 2026 → INVALID.
$r = validateAcademicPeriod('k12', '2025-2026', d('2026-08-15'));
check('K12 doc example (Aug 2026, AY 2025-2026) is INVALID', $r['valid'] === false);

$r = validateAcademicPeriod('k12', '2025-2026', d('2026-03-15'));
check('K12 mid-term (March 2026) is VALID', $r['valid'] === true);

$r = validateAcademicPeriod('k12', '2025-2026', d('2025-06-01 00:00:00'));
check('K12 start boundary (June 1 2025, 00:00) is VALID', $r['valid'] === true);

$r = validateAcademicPeriod('k12', '2025-2026', d('2025-05-31 23:59:59'));
check('K12 just before start (May 31 2025) is INVALID', $r['valid'] === false);

$r = validateAcademicPeriod('k12', '2025-2026', d('2026-03-31 23:59:59'));
check('K12 end boundary (March 31 2026, 23:59:59) is VALID', $r['valid'] === true);

$r = validateAcademicPeriod('k12', '2025-2026', d('2026-04-01 00:00:00'));
check('K12 dead zone (April 1 2026) is INVALID (confirmed strict reading)', $r['valid'] === false);

$r = validateAcademicPeriod('k12', '2025-2026', d('2026-05-31'));
check('K12 dead zone (May 31 2026, still before next AY) is INVALID', $r['valid'] === false);

// ── College — Semester is no longer captured/claimed at all (removed on
// request); validation is now purely "does the claimed Academic Year match
// the current one", valid across all three terms of that year. Semester
// still exists internally, server-derived, only to compute the right
// expiry boundary (see the expires_at tests below) ─────────────────────────
$r = validateAcademicPeriod('college', '2026-2027', d('2026-09-01')); // 1st sem month
check('College AY 2026-2027 is VALID during 1st semester month (Sept 2026)', $r['valid'] === true);

$r = validateAcademicPeriod('college', '2026-2027', d('2027-03-01')); // 2nd sem month
check('College AY 2026-2027 is VALID during 2nd semester month (March 2027) — same claimed year, no semester mismatch anymore', $r['valid'] === true);

$r = validateAcademicPeriod('college', '2026-2027', d('2027-07-01')); // midyear month
check('College AY 2026-2027 is VALID during Midyear month (July 2027) — still the same claimed year', $r['valid'] === true);

$r = validateAcademicPeriod('college', '2026-2027', d('2027-08-15')); // next AY has begun
check('College AY 2026-2027 is INVALID once the next academic year begins (Aug 2027)', $r['valid'] === false);
check('College rejection message names the current academic year, no semester wording', str_contains($r['message'] ?? '', '2027-2028') && !str_contains($r['message'] ?? '', 'Semester'));

$r = validateAcademicPeriod('college', '2025-2026', d('2026-08-01'));
check('College stale-by-a-year claim (2025-2026, now Aug 2026) is INVALID', $r['valid'] === false);

// ── Malformed / missing input ───────────────────────────────────────────────
$r = validateAcademicPeriod('k12', '20252026', d('2026-01-01'));
check('Malformed academic year (no dash) is INVALID', $r['valid'] === false);

$r = validateAcademicPeriod('k12', '2025-2027', d('2026-01-01'));
check('Non-sequential academic year (2025-2027) is INVALID', $r['valid'] === false);

// ── expires_at is the fixed period end (K12: end of AY; College: end of the
// CURRENT semester bucket, not a rolling offset from verified_at) — the
// per-semester renewal cadence survives even though validation itself is
// now year-granular, since expiry is keyed off the current bucket ─────────
$r = validateAcademicPeriod('k12', '2025-2026', d('2025-09-01'));
check('K12 expires_at is March 31 2026', $r['expires_at']?->format('Y-m-d') === '2026-03-31');

$r = validateAcademicPeriod('college', '2026-2027', d('2026-09-01')); // verified during 1st sem
check('College expires_at during 1st sem is Dec 31 2026 (end of current bucket, not end of AY)', $r['expires_at']?->format('Y-m-d') === '2026-12-31');

$r = validateAcademicPeriod('college', '2026-2027', d('2027-03-01')); // verified during 2nd sem, same AY
check('College expires_at during 2nd sem is May 31 2027', $r['expires_at']?->format('Y-m-d') === '2027-05-31');

// ── OCR presence-check helper (Academic Year only — Semester is never
// OCR-cross-checked anymore, there's nothing to check it against) ─────────
check('ocrContainsAcademicYear finds "2025-2026" in noisy OCR text', ocrContainsAcademicYear('2025-2026', "STUDENT ID\nA.Y. 2025-2026\nJUAN DELA CRUZ"));
check('ocrContainsAcademicYear rejects when absent', ocrContainsAcademicYear('2025-2026', "STUDENT ID\nA.Y. 2024-2025") === false);

// ── ocrContainsIdNumber() is deliberately EXACT, not fuzzy — a real
// reported bug: fuzzy tolerance let a deliberately mistyped ID number
// (0123300013 typed against a real ID reading 0123300011) pass, silently
// defeating the duplicate-account-prevention check this field exists for.
// Name/School/Academic Year stay fuzzy (lower stakes, genuine OCR-noise
// tolerance is the right call there) — only this field reverted ───────────
check(
    'ID number found when it EXACTLY matches the document',
    ocrContainsIdNumber('0123300011', "STUDENT ID\nID NO: 0123300011\nJUAN DELA CRUZ")
);
check(
    'ID number NOT found when genuinely a different number',
    ocrContainsIdNumber('0123300011', "ID NO: 9999999999") === false
);
check(
    'Regression: a 1-digit-off typed number must NOT match (the reported exploit — 0123300013 vs real 0123300011)',
    ocrContainsIdNumber('0123300013', "STUDENT ID\nID NO: 0123300011\nJUAN DELA CRUZ") === false
);
check(
    'Regression: an OCR misread (0/O) on the DOCUMENT side no longer helps — exact match only, accepted tradeoff',
    ocrContainsIdNumber('0123300011', "STUDENT ID\nID NO: O123300011\nJUAN DELA CRUZ") === false
);
check(
    'Academic year "2025-2026" found despite a simulated 2/Z-then-OCR\'d-as-2 misread on one digit',
    ocrContainsAcademicYear('2025-2026', "A.Y. 2O25-2026") // letter O instead of digit 0
);
check(
    'Name "DELA CRUZ" (multi-word last name) found despite a misread character in one word',
    fuzzyNameMatch('Dela Cruz', 'Juan', "STUDENT NAME: JUAN DEIA CRUZ\nSCHOOL: TEST U") // L misread as I
);
check(
    'Name NOT matched when genuinely a different person',
    fuzzyNameMatch('Santos', 'Maria', "STUDENT NAME: JUAN DELA CRUZ") === false
);
check(
    'Short ID number stays exact-match (no fuzzy false-positive on short strings)',
    ocrContainsIdNumber('123', "ABC DEF GHI JKL") === false
);

// ── fuzzySchoolMatch() — School Name is now cross-checked against the
// document too, same as name/ID number, not left unverified ───────────────
check(
    'School "Mabalacat City College" found on document, misread character tolerated',
    fuzzySchoolMatch('Mabalacat City College', "MABALACAT CITY C0LLEGE\nRizal St., Brgy. Dolores") // O misread as 0
);
check(
    'School NOT matched when genuinely a different school',
    fuzzySchoolMatch('Angeles University Foundation', "MABALACAT CITY COLLEGE") === false
);

// ── currentAcademicYearSuggestion() / currentK12Bucket() — auto-fill source.
// Semester is still returned here (server-side only, for expires_at/audit),
// even though nothing external ever asks for or checks it anymore ─────────
$s = currentAcademicYearSuggestion('k12', d('2026-09-01'));
check('K12 auto-fill suggestion for Sept 2026 is "2026-2027"', $s['academic_year'] === '2026-2027' && $s['semester'] === null);

$s = currentAcademicYearSuggestion('k12', d('2027-02-01'));
check('K12 auto-fill suggestion for Feb 2027 is "2026-2027"', $s['academic_year'] === '2026-2027');

$s = currentAcademicYearSuggestion('college', d('2026-09-01'));
check('College auto-fill suggestion for Sept 2026 is "2026-2027" (internal semester=1st)', $s['academic_year'] === '2026-2027' && $s['semester'] === '1st');

$s = currentAcademicYearSuggestion('college', d('2027-03-01'));
check('College auto-fill suggestion for March 2027 is "2026-2027" (internal semester=2nd)', $s['academic_year'] === '2026-2027' && $s['semester'] === '2nd');

// ── checkRequiredDetailsOnDocument() — the automatic enrollment-form
// trigger, Academic Year only now ───────────────────────────────────────────
$r = checkRequiredDetailsOnDocument('2026-2027', "STUDENT ID\nA.Y. 2026-2027\nJUAN DELA CRUZ");
check('Academic year present on ID -> sufficient (no enrollment form needed)', $r['sufficient'] === true);

$r = checkRequiredDetailsOnDocument('2026-2027', "STUDENT ID\nJUAN DELA CRUZ\nNO YEAR HERE");
check('Academic year absent -> insufficient (enrollment form required)', $r['sufficient'] === false && $r['missing'] === ['academic_year']);

echo "\n{$total} checks, " . ($total - $failures) . " passed, {$failures} failed.\n";
exit($failures > 0 ? 1 : 0);
