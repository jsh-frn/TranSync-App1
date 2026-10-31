<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["message" => "Method not allowed."]);
    exit;
}

require_once "../../config/rekognition.php";

// Read-only, no-DB-write pre-check polled roughly once a second by the
// mobile pose-capture wizards (student/PWD/senior registration + renewal +
// category-switch) while a commuter holds a live-turn pose — lets the app
// show real live feedback ("turn a bit more" / "hold it") instead of a
// blind countdown. This is UX only: the authoritative pass/fail check is
// still checkPoseChallenge() in config/student_verification.php, run
// server-side against the final submitted stills at registration/renewal
// time — this endpoint never writes anything and its result is never
// itself treated as a verification outcome.
if (!isset($_FILES['frame']) || $_FILES['frame']['error'] !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "frame is required."]);
    exit;
}

$result = rekognitionDetectFaces($_FILES['frame']['tmp_name']);
echo json_encode([
    "success"    => $result['success'],
    "face_found" => $result['face_found'],
    "yaw"        => $result['yaw'],
    "eyes_open"  => $result['eyes_open'],
    "provider"   => $result['provider'],
    "error"      => $result['error'],
]);
