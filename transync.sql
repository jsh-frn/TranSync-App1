-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Sep 24, 2026 at 07:24 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `transync`
--

-- --------------------------------------------------------

--
-- Table structure for table `admins`
--

CREATE TABLE `admins` (
  `id` int(11) NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `role` enum('super_admin','association_admin') NOT NULL DEFAULT 'super_admin',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `admins`
--

INSERT INTO `admins` (`id`, `name`, `email`, `password`, `role`, `created_at`) VALUES
(1, 'TranSync Admin', 'admin@transync.io', '$2y$10$txVYspiujB8I9Ei1px5xsuT34b8Fvc12DD2UhsafvOS4fTEYMJSBW', 'super_admin', '2026-03-07 14:53:55');

-- --------------------------------------------------------

--
-- Table structure for table `associations`
--

CREATE TABLE `associations` (
  `id` int(11) NOT NULL,
  `name` varchar(150) NOT NULL,
  `acronym` varchar(20) DEFAULT NULL,
  `rep_first_name` varchar(50) DEFAULT NULL,
  `rep_middle_name` varchar(50) DEFAULT NULL,
  `rep_last_name` varchar(50) DEFAULT NULL,
  `rep_suffix` varchar(20) DEFAULT NULL,
  `rep_position` varchar(100) DEFAULT NULL,
  `rep_government_id_url` varchar(255) DEFAULT NULL,
  `association_type` enum('Jeepney Op','UV Op','Bus Op') NOT NULL DEFAULT 'Jeepney Op',
  `region` varchar(100) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `coverage_area` varchar(255) DEFAULT NULL,
  `estimated_fleet_size` int(11) DEFAULT NULL,
  `contact_email` varchar(100) DEFAULT NULL,
  `official_email` varchar(150) DEFAULT NULL,
  `contact_phone` varchar(20) DEFAULT NULL,
  `official_phone` varchar(20) DEFAULT NULL,
  `document_url` varchar(255) DEFAULT NULL,
  `avatar_url` varchar(255) DEFAULT NULL,
  `supporting_document_url` varchar(255) DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `status` enum('pending','active','inactive') DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `associations`
--

INSERT INTO `associations` (`id`, `name`, `acronym`, `rep_first_name`, `rep_middle_name`, `rep_last_name`, `rep_suffix`, `rep_position`, `rep_government_id_url`, `association_type`, `region`, `address`, `coverage_area`, `estimated_fleet_size`, `contact_email`, `official_email`, `contact_phone`, `official_phone`, `document_url`, `avatar_url`, `supporting_document_url`, `password`, `status`, `created_at`) VALUES
(1, 'Demo Transport Operators Association', 'DTOA', 'Juan', NULL, 'Dela Cruz', NULL, 'President', NULL, 'Jeepney Op', 'Pampanga', '123 Demo Street, San Fernando, Pampanga', NULL, NULL, 'demo.association@transync.test', NULL, '09171234501', NULL, NULL, NULL, NULL, '$2y$10$MkPE3on.DhGeJvBoRljC8etYITSHrlaEQ5XwB0f/9mHckfLoG/EBW', 'active', '2026-08-27 01:01:55');

-- --------------------------------------------------------

--
-- Table structure for table `association_applications`
--

CREATE TABLE `association_applications` (
  `id` int(11) NOT NULL,
  `operator_id` int(11) NOT NULL,
  `association_id` int(11) NOT NULL,
  `subject_type` enum('driver','vehicle') NOT NULL,
  `subject_id` int(11) NOT NULL,
  `preferred_route_id` int(11) DEFAULT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `rejection_reason` text DEFAULT NULL,
  `reviewed_by` int(11) DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `association_memberships`
--

CREATE TABLE `association_memberships` (
  `id` int(11) NOT NULL,
  `application_id` int(11) NOT NULL,
  `operator_id` int(11) NOT NULL,
  `association_id` int(11) NOT NULL,
  `subject_type` enum('driver','vehicle') NOT NULL,
  `subject_id` int(11) NOT NULL,
  `approved_at` datetime NOT NULL DEFAULT current_timestamp(),
  `revoked_at` datetime DEFAULT NULL,
  `revoked_reason` text DEFAULT NULL,
  `status` enum('active','revoked') NOT NULL DEFAULT 'active'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `bookings`
--

CREATE TABLE `bookings` (
  `id` int(11) NOT NULL,
  `commuter_id` int(11) DEFAULT NULL,
  `vehicle_id` int(11) DEFAULT NULL,
  `route_id` int(11) DEFAULT NULL,
  `status` enum('pending','confirmed','cancelled','completed') DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `seat_id` int(11) DEFAULT NULL,
  `driver_id` int(11) DEFAULT NULL,
  `pickup_lat` decimal(10,8) DEFAULT NULL,
  `pickup_lng` decimal(11,8) DEFAULT NULL,
  `dropoff_lat` decimal(10,8) DEFAULT NULL,
  `dropoff_lng` decimal(11,8) DEFAULT NULL,
  `fare_amount` decimal(10,2) DEFAULT NULL,
  `discount_type` enum('regular','student','disabled','elderly') DEFAULT 'regular',
  `qr_code` varchar(255) DEFAULT NULL,
  `boarding_deadline` timestamp NULL DEFAULT NULL,
  `boarded_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `bus_layout_templates`
--

CREATE TABLE `bus_layout_templates` (
  `id` int(11) NOT NULL,
  `operator_id` int(11) NOT NULL,
  `service_type_id` int(11) NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `capacity` int(11) NOT NULL,
  `layout_style` enum('seater','sleeper') NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `bus_layout_template_seats`
--

CREATE TABLE `bus_layout_template_seats` (
  `id` int(11) NOT NULL,
  `template_id` int(11) NOT NULL,
  `seat_label` varchar(10) NOT NULL,
  `seat_row` int(11) NOT NULL,
  `seat_col` int(11) NOT NULL,
  `seat_type` enum('window','aisle','sleeper','driver','conductor','blank') NOT NULL DEFAULT 'window'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `bus_schedules`
--

CREATE TABLE `bus_schedules` (
  `id` int(11) NOT NULL,
  `association_id` int(11) NOT NULL,
  `route_id` int(11) NOT NULL,
  `service_type_id` int(11) NOT NULL,
  `boarding_time` time NOT NULL,
  `departure_time` time NOT NULL,
  `recurrence_type` enum('daily','weekly') NOT NULL DEFAULT 'daily',
  `weekdays` varchar(20) DEFAULT NULL COMMENT '0=Sun..6=Sat, comma-separated; only used when recurrence_type=weekly',
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `bus_schedules`
--

INSERT INTO `bus_schedules` (`id`, `association_id`, `route_id`, `service_type_id`, `boarding_time`, `departure_time`, `recurrence_type`, `weekdays`, `status`, `created_at`) VALUES
(1, 1, 2, 1, '01:00:00', '02:30:00', 'daily', NULL, 'active', '2026-09-24 17:11:35'),
(2, 1, 2, 1, '02:30:00', '04:00:00', 'daily', NULL, 'active', '2026-09-24 17:11:54'),
(3, 1, 2, 1, '04:00:00', '05:30:00', 'daily', NULL, 'active', '2026-09-24 17:12:14'),
(4, 1, 2, 1, '05:30:00', '07:00:00', 'daily', NULL, 'active', '2026-09-24 17:12:47');

-- --------------------------------------------------------

--
-- Table structure for table `bus_service_types`
--

CREATE TABLE `bus_service_types` (
  `id` int(11) NOT NULL,
  `operator_id` int(11) DEFAULT NULL,
  `association_id` int(11) DEFAULT NULL,
  `name` varchar(50) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `bus_service_types`
--

INSERT INTO `bus_service_types` (`id`, `operator_id`, `association_id`, `name`, `description`, `created_at`) VALUES
(1, NULL, 1, 'Ordinary Class', '', '2026-09-17 18:14:39');

-- --------------------------------------------------------

--
-- Table structure for table `commuters`
--

CREATE TABLE `commuters` (
  `id` int(11) NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `first_name` varchar(50) DEFAULT NULL,
  `middle_name` varchar(50) DEFAULT NULL,
  `last_name` varchar(50) DEFAULT NULL,
  `suffix` varchar(20) DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `category` enum('default','student','disabled','elderly') DEFAULT 'default',
  `discount_id_url` varchar(255) DEFAULT NULL,
  `avatar_url` varchar(255) DEFAULT NULL,
  `is_verified` tinyint(1) DEFAULT 0,
  `rejected_at` datetime DEFAULT NULL,
  `rejection_reason` text DEFAULT NULL,
  `status` enum('active','inactive') DEFAULT 'active',
  `deactivated_at` datetime DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `destination_lat` decimal(10,8) DEFAULT NULL,
  `destination_lng` decimal(11,8) DEFAULT NULL,
  `is_looking` tinyint(1) DEFAULT 0,
  `location_updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `commuters`
--

INSERT INTO `commuters` (`id`, `name`, `first_name`, `middle_name`, `last_name`, `suffix`, `date_of_birth`, `email`, `password`, `phone`, `category`, `discount_id_url`, `avatar_url`, `is_verified`, `rejected_at`, `rejection_reason`, `status`, `deactivated_at`, `deleted_at`, `created_at`, `latitude`, `longitude`, `destination_lat`, `destination_lng`, `is_looking`, `location_updated_at`) VALUES
(66, 'Marthy Mungcal Manalo', 'Marthy', 'Mungcal', 'Manalo', NULL, '2004-09-10', 'manalomarthy96@gmail.com', '$2y$10$ha.e9UbWGrxLnnZvbmanNu1pS/60VwET2NXluRwF8AwqGq0k7uHqy', '09914859762', 'student', 'uploads/commuters/student_front_1786725079_6a7f42d7a5392.jpg', 'uploads/avatars/commuter_66_1786725134_6a7f430eb8fd5.png', 1, NULL, NULL, 'active', NULL, NULL, '2026-08-14 16:31:19', 15.15851990, 120.59253560, NULL, NULL, 1, '2026-08-26 04:13:55'),
(67, 'Shiena Marquez', 'Shiena', NULL, 'Marquez', NULL, '2005-01-30', 'shienamarquez07@gmail.com', '$2y$10$11TgS/eRXLG2VkQ/sp7wOugDhQMHv2AbrOjFDzWra7.W.ChNTv8UG', '09910737284', 'student', 'uploads/commuters/student_front_1786732717_6a7f60ad1a8c7.jpg', 'uploads/avatars/commuter_67_1786733203_6a7f62933ccd7.jpeg', 1, NULL, NULL, 'active', NULL, NULL, '2026-08-14 18:38:37', 0.00000000, 0.00000000, NULL, NULL, 0, '2026-08-15 18:08:22'),
(68, 'IAN JHAIREL CANTORIA FELICIANO', 'IAN JHAIREL', 'CANTORIA', 'FELICIANO', NULL, '2004-12-11', 'felicianoianjhairel@gmail.com', '$2y$10$tNUo1PAl40.BMVFa3oWEKeyOOW/785qRsrd8MCh9XS6x4LhrLLT1W', '09752133529', 'student', 'uploads/commuters/student_front_1786946350_6a82a32e13b9c.jpg', 'uploads/avatars/commuter_68_1786946477_6a82a3ad6582a.jpeg', 1, NULL, NULL, 'active', NULL, NULL, '2026-08-17 05:59:10', 0.00000000, 0.00000000, NULL, NULL, 0, '2026-08-17 06:02:13'),
(70, 'Cyrel Layug Fernando', 'Cyrel', 'Layug', 'Fernando', NULL, '2004-09-29', 'stclarelayucyrel@gmail.com', '$2y$10$ZgJEnwVATv/FP8SnHPvlh.J6m0SpH/VbtPmgdRrwqq3t24Gg4uIVG', '09683212491', 'student', 'uploads/commuters/student_front_1787360445_6a88f4bd9704b.jpg', NULL, 1, NULL, NULL, 'active', NULL, NULL, '2026-08-22 01:00:45', 15.15849440, 120.59260530, NULL, NULL, 1, '2026-08-22 01:02:32'),
(72, 'Rachell P. Evangelista', 'Rachell', 'P.', 'Evangelista', NULL, '1988-01-23', 'rachellcarl08@gmail.com', '$2y$10$eIhk8ofZF8GyChk87j7pAu8yWitPOf1PM1a3gzLErCNw8QtuCI4.a', '09241401040', 'disabled', 'uploads/commuters/pwd_front_1787743596_6a8ecd6ca42cc.jpg', NULL, 1, NULL, NULL, 'active', NULL, NULL, '2026-08-26 11:26:36', NULL, NULL, NULL, NULL, 0, NULL),
(73, 'Ana Cruz', 'Ana', NULL, 'Cruz', NULL, NULL, 'demo.commuter@transync.test', '$2y$10$MkPE3on.DhGeJvBoRljC8etYITSHrlaEQ5XwB0f/9mHckfLoG/EBW', '09171234505', 'default', NULL, NULL, 0, NULL, NULL, 'active', NULL, NULL, '2026-08-27 01:17:12', 0.00000000, 0.00000000, NULL, NULL, 0, '2026-09-24 16:37:28'),
(78, 'Wayne Sebastian Catacutan', 'Wayne', 'Sebastian', 'Catacutan', NULL, NULL, 'wayne.catacutan@transync.test', '$2y$10$YEQsI21CaClABzsHlxmDdO9hEXJfj.Zpy9Il/j2AUIZrRqVgP3iYm', '09171234506', 'default', NULL, NULL, 0, NULL, NULL, 'active', NULL, NULL, '2026-09-20 05:14:44', NULL, NULL, NULL, NULL, 0, NULL),
(79, 'John Crissean Lobo', 'John', 'Crissean', 'Lobo', NULL, NULL, 'john.lobo@transync.test', '$2y$10$YEQsI21CaClABzsHlxmDdO9hEXJfj.Zpy9Il/j2AUIZrRqVgP3iYm', '09171234507', 'default', NULL, NULL, 0, NULL, NULL, 'active', NULL, NULL, '2026-09-20 05:14:44', NULL, NULL, NULL, NULL, 0, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `commuter_id_verifications`
--

CREATE TABLE `commuter_id_verifications` (
  `id` int(11) NOT NULL,
  `commuter_id` int(11) NOT NULL,
  `category` enum('student','disabled','elderly') NOT NULL DEFAULT 'student',
  `last_name` varchar(100) NOT NULL,
  `first_name` varchar(100) NOT NULL,
  `middle_name` varchar(100) DEFAULT NULL,
  `school_name` varchar(150) DEFAULT NULL,
  `academic_year` varchar(20) DEFAULT NULL,
  `semester` enum('1st','2nd','midyear') DEFAULT NULL,
  `student_id_number` varchar(50) DEFAULT NULL,
  `id_number` varchar(50) DEFAULT NULL,
  `birthdate` date DEFAULT NULL,
  `issuing_lgu` varchar(150) DEFAULT NULL,
  `date_issued` date DEFAULT NULL,
  `validity_date` date DEFAULT NULL,
  `id_type` enum('k12','college') DEFAULT NULL,
  `id_front_path` varchar(255) NOT NULL,
  `id_back_path` varchar(255) NOT NULL,
  `enrollment_form_path` varchar(255) DEFAULT NULL,
  `selfie_center_path` varchar(255) NOT NULL,
  `selfie_left_path` varchar(255) NOT NULL,
  `selfie_right_path` varchar(255) NOT NULL,
  `ocr_raw_text` text DEFAULT NULL,
  `ocr_match_result` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `face_match_score` decimal(5,2) DEFAULT NULL,
  `liveness_result` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `provider` varchar(30) NOT NULL COMMENT 'demo | aws_rekognition',
  `verification_status` enum('verified','failed','pending_review') NOT NULL DEFAULT 'verified',
  `verified_at` datetime DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL COMMENT 'verified_at + 10mo (K-12) or 5mo (college)',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `commuter_id_verifications`
--

INSERT INTO `commuter_id_verifications` (`id`, `commuter_id`, `category`, `last_name`, `first_name`, `middle_name`, `school_name`, `academic_year`, `semester`, `student_id_number`, `id_number`, `birthdate`, `issuing_lgu`, `date_issued`, `validity_date`, `id_type`, `id_front_path`, `id_back_path`, `enrollment_form_path`, `selfie_center_path`, `selfie_left_path`, `selfie_right_path`, `ocr_raw_text`, `ocr_match_result`, `face_match_score`, `liveness_result`, `provider`, `verification_status`, `verified_at`, `expires_at`, `created_at`) VALUES
(39, 66, 'student', 'Manalo', 'Marthy', 'Mungcal', 'Systems Plus College Foundation', '2026-2027', '1st', '0123300011', NULL, NULL, NULL, NULL, NULL, 'college', 'uploads/commuters/student_front_1786725079_6a7f42d7a5392.jpg', 'uploads/commuters/student_back_1786725079_6a7f42d7a56a7.jpg', NULL, 'uploads/commuters/student_selfie_center_1786725079_6a7f42d7a586f.jpg', 'uploads/commuters/student_selfie_left_1786725079_6a7f42d7a5a1b.jpg', 'uploads/commuters/student_selfie_right_1786725079_6a7f42d7a5b92.jpg', '\n\nSYSTEMS PLUS COLLEGE FOUNDATION eS\nMARTHY M. MANALO\n| — 4TH YEAR COLLEGE - BSIT\n0123300011\nSy CCIS-MAIN\n\nMS a»\n\nSYSTEMS PLUS COLLEGE FOU ND. ee\n\nMARTHY M. MANALO\n\nATH YEAR COLLEGE - BSIT\n\n0123300011\n\n.\n\nVALIDITY: A.Y. 2026-2027\n\naie\n\n>\n\npa tt\n\nCCIS-MAIN\n\n\nTHIS ID IS NON-TRANSFERABLE AND SHALL BE\nCONFISCATED WHEN USED BY OTHERS.\nWEAR THIS ID CARD WHILE INSIDE SPCF\nPREMISES\nAND PRESENT TO SPCF OFFICERS UPON DEMAND.\nSod.\n[ee [R] Mom. tourpesr.BusTAMANTE = [a] SF [a]\nrl: PRESIDENT\nee es ,\n[a] eee WWW.SPCF.EDU.PH ORE\n\nTHIS ID IS NON-TRANSFERABLE AND SHALL BE\n\nCONFISCATED WHEN USED BY OTHERS.\n\nWEAR THIS ID CARD WHILE INSIDE SPCF\n\nPREMISES\n\nAND PRESENT TO SPCF OFFICERS UPON DEMAND.\n\nfoff\n\nMDM. LOURDES R. BUSTAMANTE\n\noF.\n\nPRESIDENT\n\n[a]:\n\ngi ak\n\n» nl\n\nse\n\nWWW.SPCFEDU.PH\n\n[alts\n\nsitar ne aa\n', '{\"ocr_ran\":true,\"review_reasons\":[]}', 100.00, '{\"provider\":\"aws_rekognition\",\"center_yaw\":-2.342916488647461,\"left_yaw\":20.831680297851562,\"right_yaw\":-31.69565200805664}', 'aws_rekognition', 'verified', '2026-08-14 18:31:19', '2026-08-01 23:59:59', '2026-08-14 16:31:19'),
(40, 67, 'student', 'Marquez', 'Shiena', NULL, 'Colegio de Calumpit Inc.', '2026-2027', '1st', '2408711', NULL, NULL, NULL, NULL, NULL, 'college', 'uploads/commuters/student_front_1786732717_6a7f60ad1a8c7.jpg', 'uploads/commuters/student_back_1786732717_6a7f60ad1aedf.jpg', 'uploads/commuters/student_enrollment_1786732717_6a7f60ad1b404.jpg', 'uploads/commuters/student_selfie_center_1786732717_6a7f60ad1bd9e.jpg', 'uploads/commuters/student_selfie_left_1786732717_6a7f60ad1c556.jpg', 'uploads/commuters/student_selfie_right_1786732717_6a7f60ad1cd28.jpg', '\n\nf eM te 22 “Unie as Dy Sh eee\na om i a\nSi Si ‘oe ee eae ae reer hy\n] 2 Bey Ay eo a aaa ‘\nPeay ks 1 i aa i\nPere Mince San aha i\na =e Ae as cee\nie, a EE SS a\na : A eee\npacked SURES aes eee\n: ag a7 ts. ai wees\ni ane pee (ERD SEBS a Ara alec\n: l ye , eee i\nBee pes = itl 3° ie eee eee i\na Beige <\',\'« SS ee\n} i Sabet ss eee i fa 3\n4. feet ate f ating ES £\n1 ee ee ee f F\n] mete i i :\nrl nk ene ooo Bplis aaa ees i .\n© eS ee i. ee ees\ni ie re es A? ee Ps\nJ fat ecw ter : Si Me eae lee\n] : pemeeF : SRS Be Bie te t\n| \\ fare ‘& pe AZ en is 5\nBeers ges”: e ee sk cS\nNee ip oT if Be PS i i age ee aan 3\nj - eee ole one is e en eee\nHl ers i ae ge Ge ee ae es =\n\\ ares: ch gre is a .\nme ee ee\n. : é % eet. ole ee ee eee\n5 nee Se a\n3 ae ; oo sk Sg cee mee\na\nNes \' 2 g “oa aes clsom cA p\noe eee E\ni : ou 5 ee aes é\nBe ay is oy SE Bee ae\nary =f Ps VE LAGE uh 98 aes\nWY 5 yz ghee = 5 eo\nFs 5 en io Fhe Eo ot a -\n( er 1p eae dee ae Ef\n— = ei cf, i ‘\n3 Be. Py a8 Eg ES ot alae te et\nTis spi Rag aia 7 a ee a\nLe d eo ae aera ana\nway \"re a ge ean eee ei nee a ed F\nAe Re i fee Plies oth nas ae ata Bee ae F\nSe aS ae Z\n; ; ape ers Sikes apo Ay ies a f\n— fe ee ra\ncaer } = 5 # a\n; , sep Sc ee se ’\nae 7\nnti ee :\nwD oS a i\npies ie a Pee\ni = es E Be i a\n7 — ae a erreee\ned eee Z:\nat : — e\ncd e * : be\ni “a i Sere\n\\ a : eRe NEC aia 3\n: re RBs ae.\nDoel a Be er ee\n\n2\n\n3a\n\noF\n\nae\n\nGee\n\n2.\n\na\n\nber\n\nes\n\nES\n\npec\n\nSex\n\nf\n\nx\n\nfe\n\nps\n\ni\n\nyl\n\nvas\n\nna |\n\nPi\n\na\n\na\n\nGy.\n\na.\n\nPee\n\nne 3\n\nie\n\nvee\n\nhi\n\niy\n\n>a\n\nSs\n\nW\n\nNos\n\n\"\n\n=\n\npee\n\nY)\n\nDs\n\n_\n\nie\n\ney,\n\nie\n\noe\n\niste\n\nioe\n\nsae\n\nSaat\n\nae\n\nss\n\nas\n\n2\n\n.\n\n=e 5)\n\nee\n\n‘avs\n\neral\n\nSees\n\n=\n\na\n\neo\n\n\nee eee a a ig ae\nee ke ela Address:\nie Aree ee Phe eta di F\nOe es $90 Dike Corazon Calumpit Bulacan\n1G Contact No: 99/0737284\n[ee Signature:\n- eo \\\n| In Case of Emergency, Contact:\nGuardian: Cyril C. Marquez\n4 Contact No. 9297936851\nry. “sed : F i ati | ie G\ni =e REMINDERS\na : “ tl der, ied fhis card in non-transferable. it must be |\nGey) a 3 Z \"9 ae ay E is Ca in non-transie J WwW ere\ngies gee iy ss ee conspicuously worn in the blouse or snirt at Gig\nil a oil Oe glial lar os alae while inside COLEGIO DE CALUMPIT, INC, Camm\na one in case of loss, finder is requested am i et :\nto return this card to Bo 4\nCOLEGIO DE CALUMPIT, INC ea\niba O ‘Este, Calumpit, Bulacan am |\ni L ae |\nEdndtiza M. Victoria, Ph.D, “ae }\nCollege Dear a\nTRULY THE Fi\n\nei\n\nAddress:\n\n$50 Dike Corazon Calumpit Bulacan\n\na\n\nContact No:\n\nee\n\n9910737284\n\nro\n\nSignature:\n\ne)\n\nIn Case of Emergency, Contact:\n\nGuardian:\n\nCyril C. Marquez\n\nContact No\n\n9297936851\n\nREMINDERS\n\neae\n\n_\n\n1p\n\nihis card in non-transferable. it must be\n\n2\n\n*\n\nconspicuously worn in the blous\n\n2\n\ne or shirt ot aff\n\nier\n\nwhile inside COLEGIO DE CALUMPIT, INC. c@\n\nOr mea\n\nEJ\n\nIn case of loss, finder is requested\n\nto return this card to\n\nCOLEGIO DE CALUMPIT, INC\n\nipa O ‘Este, Calumpit, Bulacan\n\n4\n\n/\n\nZ\n\nL\n\nYAM\n\nEdnd {Liza M. Victoria, Ph.D,\n\nCollege Dean\n\noe\n\nacne mes\n\nTRULY THE FINE\n\nS)\n\n\nome 4\nma CL) | - v & a weaken ae i\nes &. I a, fe < 3\nied t < (4 eke a j\net “9 4\na | i] \\ AW aes 5 = {\na Bi \' eee fe 4\n=\" , 4 . *Tiaey i 4 i\npaki x fh , | 4 :\nee | od = J\na | ee me 4\nAa tet tt Best te\nety ere 7 ie oe ee ae ae ;\nBee, | tee eae ey a 4\nee 7 =e y in ek oe So wi C OREO ES - ee a oe a = Ce\n. F | Sie ts = oes e gic Si RE EGGS Bear ee\n_— F RISIE=/E ee\nis F oisti—lal Zz ee\n) Ses lola ls yo (eee ee\nr Y S18 16 co Oe\n, Z. Fi AG ie RS cae ee ene ee\n4 0 a” oa) 5S ¢ oy oe sO oes\n| al r - t RR SSS ee eee\nA e . - RG La ie Be ale eee aa oe Beeateits\n: \" os orm 483 BNSC eS tee cp era\n= N Sle ie? |e ~~ Se\nBris i Ol> Simini-c 8 GQ ~*~ ee :\nPO | ‘ =] sm 4 fm tm: 1 oD So i le <9 IR ONS aa aoe See\nMISE (OlZ El EIe (Sie Eley [Sle . 8\nes > a 5 | ee toe : ; bes Tbe { \\ Soo eee ee\nWe £18 2 55 15 € eo cee\nfF ais §C ip Bisi=is {fee ON i 4 ee\n, ; * O : PCa ASR al ooo ar aa\nPe iS I= IE 15 Alo Ico l= Sin oo f oS.\npag | Sizic | wie oO O18 Po - ee\nos er ~ oe “ed aan b oO —s = Tiel eee\na ? az 1s 15 19 o 3 | z ee\nre : 7? wi te. e ae\noe d Sad j\nBe: ; iF : :\n= : Bree |\n_ Fe . ; }\n= es ; x i } ; i\nzs 4 . p< saben pan no Spore ee - {\n2 < t i % a * } > . \' =\nF : tf S| Z\n4 : 4 Q | | is\nF a 5 | | .\nf Z \' roe 4 a I $\nE g # : ; : ‘ be te en s i ; ;\ne 2 +30 & Bey het i tot = pee ohn = z ‘ee _ 4 pay\n< e in £ z tr te os eS oc tA Ge | Se | ig\nE : . ~ ie is Sis SiS is 11S / | iS\na & ee Sets ela ta tales la lis 1 : tS\n: ae ef ie eee ee ee me ee a j : i e\n2 2 aI a me oat lei a ah al hema A Sone Seal DS Sk Sd Sut he timdennulennmiunanntiad\nE oy\n\nwees\n\nad\n\nae\n\naie\n\n+6 oO\n\nLeo\n\nEs\n\nir\n\n4)\n\nay\n\nhe\n\nL¥]\n\nZA\n\nry\n\na*\n\n9,\n\noS\n\n#\n\nacer\n\nre\n\nae\n\nais\n\nGO\n\n—*\n\nsai ga a\n\nail\n\nM\n\na>\n\nw\n\no\n\nQ\n\nA\n\n&\n\nae\n\nw\n\nPL\n\nss\n\nof\n\nee\n\nwm\n\ni iil\n\nos ial\n\n—e\n\nJit\n\nt2\n\nNag 2\n\nw\n\njune\n\n—:\n\nGa\n\n=\n\nbets\n\nRS\n\n=\n\nas\n\nwn\n\no\n\nas\n\nOQ\n\noe)\n\nme\n\nwe)\n\na3\n\naa\n\nao\n\nQO\n\nQ\n\naoe\n\non\n\nQ\n\nwae\n\ngs\n\nmoh\n\nee\n\na\n\npe\n\no\n\nmel\n\nig\n\nfe\n\n*\n\nNog\n\n=\n\noS\n\nis\n\nx\n\ni\n\n+i\n\n5 f\n\nLA\n\n=\n\niat\n\n=\n\na\n\na\n\n=\n\ni\n\nona le ih comet\n\nwae\n\nwwe\n\nee\n\nsmal\n', '{\"ocr_ran\":true,\"review_reasons\":[\"name_mismatch\",\"id_number_mismatch\",\"academic_year_unconfirmed\"]}', 99.95, '{\"provider\":\"aws_rekognition\",\"center_yaw\":-1.8909897804260254,\"left_yaw\":39.490318298339844,\"right_yaw\":-42.55180358886719}', 'aws_rekognition', 'pending_review', '2026-08-14 18:38:37', NULL, '2026-08-14 18:38:37'),
(41, 68, 'student', 'FELICIANO', 'IAN JHAIREL', 'CANTORIA', 'SYSTEMS PLUS COLLEGE FOUNDATION', '2026-2027', '1st', '0123302438', NULL, NULL, NULL, NULL, NULL, 'college', 'uploads/commuters/student_front_1786946350_6a82a32e13b9c.jpg', 'uploads/commuters/student_back_1786946350_6a82a32e14660.jpg', NULL, 'uploads/commuters/student_selfie_center_1786946350_6a82a32e14c0b.jpg', 'uploads/commuters/student_selfie_left_1786946350_6a82a32e14e49.jpg', 'uploads/commuters/student_selfie_right_1786946350_6a82a32e14fb8.jpg', '\n\nsa\nif?\n——§f ly\n@ ove\ney\nYSTEMS PLUS COLLEGE FOUNDATION @\n4 IAN JHAIRELC.FELICIANO\na 4TH YEARCOLLEGE-Bsit_ ‘|\n. _ 0123302438\nae VALIDITY: A. Y. 2026-2027\nwow. mimes\nTe he\n: ~_ Ps\n\n@\n\n»\n\na\n\na\n\n= ‘2\n\n@ ove\n\ney\n\n> YSTEMS PLUS COLLEGE FOUNDATION\n\n©\n\nIAN JHAIREL C. FELICIANO\n\na\n\n4TH YEAR COLLEGE - BSIT\n\nLom.\n\n012330\n\nVALIDITY: A.Y. 2026-2027\n\na\n\nViewer\n\n— ae\n\ni\n\n_\n\noe\n\nital) ie\n\na\n\nPs\n\n\n| -_ — ==\n——— ee g\nSS Tr\nic\n‘i= * | | )\na oa, = \'_ =-\nL ine SS |\nTHIS ID IS NON-TRANSFERABLE AND SHALL BE Ne\nCONFISCATED WHEN USED BY OTHERS. e\n— WEAR THIS ID CARD WHILE INSIDE SPCF \\ con\nPREMISES i ~~\n% AND PRESENT TO SPCF OFFICERS UPON DEMAND.\n: =\nSod. Gms *\nnga MDM. LOURDES R. BUSTAMANTE . wy\neI ee, , PRESIDENT [=] [=] \\\nSe oo e ! .\npeare esr:\na ogre WWW.SPCF.EDU.PH fe) ED\n, )\n_— —\ni _®\nym Y a e\ny Tr rm a 7 4 de\n\ngi\n\n_\n\nss... OU\n\n=\n\n1\n\n—\n\n-\n\ned\n\nAB\n\nOE ce\n\nTHIS ID IS NON-TRANSFERABLE AND SHALL BE\n\n—\n\nCONFISCATED WHEN USED BY OTHERS.\n\nS\n\na\n\nWEAR THIS ID CARD WHILE INSIDE SPCF\n\nPREMISE\n\n>\n\nAND PRESENT TO SPCF OFFICERS UPON DEMAND\n\nClas\n\n‘Ge 3 1\n\nMDM. oe R. BUSTAMANTE\n\n[a]\n\n[a]\n\nae\n\nLa\n\nBling El\n\nRESIDENT\n\neee I\n\nasthe\n\nWWW.SPCF.EDU.PH\n\n=\n\na\n\nrs\n\nSe\n\n ~ »\n\nTr\n\na 7\n', '{\"ocr_ran\":true,\"review_reasons\":[]}', 100.00, '{\"provider\":\"aws_rekognition\",\"center_yaw\":-0.34549227356910706,\"left_yaw\":58.157012939453125,\"right_yaw\":-58.23564147949219}', 'aws_rekognition', 'verified', '2026-08-17 05:59:10', '2026-12-31 23:59:59', '2026-08-17 05:59:10'),
(43, 70, 'student', 'Fernando', 'Cyrel', 'Layug', 'Systems Plus College Foundation', '2026-2027', '1st', '0123302329', NULL, NULL, NULL, NULL, NULL, 'college', 'uploads/commuters/student_front_1787360445_6a88f4bd9704b.jpg', 'uploads/commuters/student_back_1787360445_6a88f4bd97b58.jpg', NULL, 'uploads/commuters/student_selfie_center_1787360445_6a88f4bd98130.jpg', 'uploads/commuters/student_selfie_left_1787360445_6a88f4bd9833b.jpg', 'uploads/commuters/student_selfie_right_1787360445_6a88f4bd986c3.jpg', '\n\n* a 2 —\" a\"\nen ue 2\nM ¢€ ; i ue\nYSTEMS PLUS COLLEGE FOUNDATION Sane\n\" CYREL L. FERNANDO\n| \"3 4TH YEAR COLLEGE - BSIT\ni < 0123302329\n— VALIDITY: A. Y. 2026-2027\na a\nis - s \' ei\nj or : i & ; e . ; ;\n| i]\n\neee nner\n\nEa\n\nFabs het\n\nAPPR OU Re LI EVEN\n\nCYREL L. FERNANDO\n\n4TH YEAR COLLEGE - BSIT\n\npm\n\net\n\n“ee\n\n0123302329\n\nVALIDITY: A.Y. 2026-2027\n\na\n\naa\n\naly\n\n|\n\na\n\n\nee :\nWhe 7 ae\n\\ 5% és Z y rs\n9 ema EN LAU RRS\nTHIS ID IS NON-TRANSFERABLE AND SHALL BE e.\nCONFISCATED WHEN USED BY OTHERS. pb\np-\nWEAR THIS ID CARD WHILE INSIDE SPCF |\nPREMISES e\n| AND PRESENT TO SPCF OFFICERS UPON DEMAND. BE\nns sod. He\n: 2 MDM. LOURDES R. BUSTAMANTE se\n=] pee: PRESIDENT Oo 4 El\n; ar, eo ‘1 eS ah . 0\nmeee WWW.SPCF.EDU.PH fa).\n\ni\n\n=\n\nSeat ee\n\nied weet\n\nTHIS iD is NON- TRANSFERABLE AND SHALL BE\n\nCONFISCATED WHEN USED BY OTHERS.\n\nWEAR THIS ID CARD WHILE INSIDE SPCF\n\nPREMISES\n\nAND PRESENT TO SPCF OFFICERS UPON DEMAND.\n\nClas\n\ni 5\n\n}- <5)\n\nMDM. LOURDES R. BUSTAMANTE\n\ner\n\na\n\noF\n\nat\n\noe\n\nfl\n\ned\n\n(alt\n\nwww SPCFEDU PH\n', '{\"ocr_ran\":true,\"review_reasons\":[]}', 99.99, '{\"provider\":\"aws_rekognition\",\"center_yaw\":-3.0244357585906982,\"left_yaw\":38.167911529541016,\"right_yaw\":-49.82820510864258}', 'aws_rekognition', 'verified', '2026-08-22 01:00:45', '2026-12-31 23:59:59', '2026-08-22 01:00:45'),
(45, 72, 'disabled', 'Evangelista', 'Rachell', 'P.', NULL, NULL, NULL, NULL, '0354010000010190', NULL, 'City of San Fernando', NULL, '2029-07-08', NULL, 'uploads/commuters/pwd_front_1787743596_6a8ecd6ca42cc.jpg', 'uploads/commuters/pwd_back_1787743596_6a8ecd6ca4c57.jpg', NULL, 'uploads/commuters/pwd_selfie_center_1787743596_6a8ecd6ca51aa.jpg', 'uploads/commuters/pwd_selfie_left_1787743596_6a8ecd6ca5529.jpg', 'uploads/commuters/pwd_selfie_right_1787743596_6a8ecd6ca58ed.jpg', '\n\nS De\nz= mE Si6_ ee\nS| =\\& ig\n3 ae [<I\n| S De SE\n| e ide ae Oe\n\n5\n\nas\n\n£2\n\nal\n\n3\\6\n\nStra’ S\n\nChi te\n\nre\n\nLi\n\n>i ee\n\n\nzi ere\nHa\ni Fee ze\ncy Hi A a:\na UE\n:\n\ns 2\n\n2 §\n\n#&\n\n29\n\nog 7\n\nZ2o\n\n= ¢\n\n3 2\n\nc &\n\ng\n\ns >\n\n1\n\ni\n\ni\n\n=x\n\ni\n\niF\n\n|\n\nals\n\n[i\n\nf\n\n: is;\n\nEs\n\n;\n', '{\"ocr_ran\":true,\"outcome\":\"rejected\"}', 98.97, '{\"provider\":\"aws_rekognition\",\"center_yaw\":-2.758979082107544,\"left_yaw\":50.626991271972656,\"right_yaw\":-41.599124908447266}', 'aws_rekognition', 'verified', '2026-09-20 13:01:28', '2029-07-08 23:59:59', '2026-08-26 11:26:36');

-- --------------------------------------------------------

--
-- Table structure for table `consent_acceptances`
--

CREATE TABLE `consent_acceptances` (
  `id` int(11) NOT NULL,
  `account_type` enum('commuter','operator','association') NOT NULL,
  `account_id` int(11) NOT NULL,
  `terms_version` varchar(20) NOT NULL,
  `privacy_version` varchar(20) NOT NULL,
  `accepted_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `consent_acceptances`
--

INSERT INTO `consent_acceptances` (`id`, `account_type`, `account_id`, `terms_version`, `privacy_version`, `accepted_at`) VALUES
(15, 'commuter', 66, '1.0', '1.0', '2026-08-15 00:31:19'),
(16, 'commuter', 67, '1.0', '1.0', '2026-08-14 18:38:37'),
(17, 'commuter', 68, '1.0', '1.0', '2026-08-17 05:59:10'),
(18, 'commuter', 69, '1.0', '1.0', '2026-08-17 06:06:29'),
(19, 'commuter', 70, '1.0', '1.0', '2026-08-22 01:00:45'),
(20, 'commuter', 71, '1.0', '1.0', '2026-08-24 13:06:07'),
(21, 'commuter', 72, '1.0', '1.0', '2026-08-26 11:26:36');

-- --------------------------------------------------------

--
-- Table structure for table `dispatch_queue`
--

CREATE TABLE `dispatch_queue` (
  `id` int(11) NOT NULL,
  `driver_id` int(11) NOT NULL,
  `operator_id` int(11) NOT NULL,
  `route_id` int(11) DEFAULT NULL,
  `status` enum('waiting','dispatched','completed','cancelled') NOT NULL DEFAULT 'waiting',
  `joined_at` datetime NOT NULL DEFAULT current_timestamp(),
  `started_at` datetime DEFAULT NULL,
  `ended_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `dispatch_queue`
--

INSERT INTO `dispatch_queue` (`id`, `driver_id`, `operator_id`, `route_id`, `status`, `joined_at`, `started_at`, `ended_at`) VALUES
(1, 1, 1, NULL, 'completed', '2026-08-27 09:11:40', '2026-08-27 09:11:43', '2026-09-24 12:44:28'),
(2, 1, 1, NULL, 'completed', '2026-09-24 12:44:22', '2026-09-24 12:44:26', '2026-09-24 12:44:28'),
(3, 1, 1, NULL, 'completed', '2026-09-24 12:44:32', '2026-09-24 12:44:33', '2026-09-24 12:44:34');

-- --------------------------------------------------------

--
-- Table structure for table `drivers`
--

CREATE TABLE `drivers` (
  `id` int(11) NOT NULL,
  `operator_id` int(11) DEFAULT NULL,
  `association_id` int(11) DEFAULT NULL,
  `vehicle_id` int(11) DEFAULT NULL,
  `name` varchar(100) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `license_number` varchar(100) DEFAULT NULL,
  `avatar_url` varchar(255) DEFAULT NULL,
  `status` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `heading` float DEFAULT 0,
  `is_full` tinyint(1) DEFAULT 0,
  `is_online` tinyint(1) DEFAULT 0,
  `qr_code` varchar(255) DEFAULT NULL,
  `wallet_balance` decimal(10,2) DEFAULT 0.00,
  `location_updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `drivers`
--

INSERT INTO `drivers` (`id`, `operator_id`, `association_id`, `vehicle_id`, `name`, `email`, `password`, `phone`, `license_number`, `avatar_url`, `status`, `created_at`, `latitude`, `longitude`, `heading`, `is_full`, `is_online`, `qr_code`, `wallet_balance`, `location_updated_at`) VALUES
(1, 1, NULL, 1, 'Juan Santos', 'demo.driver1@transync.test', '$2y$10$MkPE3on.DhGeJvBoRljC8etYITSHrlaEQ5XwB0f/9mHckfLoG/EBW', '09171234503', 'LIC-DEMO-001', NULL, 'active', '2026-08-27 01:01:55', 0.00000000, 0.00000000, 0, 0, 0, NULL, 703.00, '2026-09-24 15:48:14'),
(2, 1, NULL, 2, 'Maria Garcia', 'demo.driver2@transync.test', '$2y$10$MkPE3on.DhGeJvBoRljC8etYITSHrlaEQ5XwB0f/9mHckfLoG/EBW', '09171234504', 'LIC-DEMO-002', NULL, 'active', '2026-08-27 01:01:55', NULL, NULL, 0, 0, 0, NULL, 0.00, NULL),
(3, 1, NULL, 4, 'Juan Miguel Santos', 'juan.santos@transync.demo', '$2y$10$rRRN89GaivWwW4ZQTcAYT.M2HeaMF6BL2C6DxAItZ/7.h/UIUHnFO', '0917-245-6813', 'N01-23-456789', NULL, 'active', '2026-09-20 11:54:26', NULL, NULL, 0, 0, 0, NULL, 0.00, NULL),
(4, 1, NULL, 6, 'Roberto Dela Cruz', 'demo.driver.bus@transync.test', '$2y$10$AbZ5ckAcgRjC8COuS2RJrOZz9inA/EOzyHvUt/FKp8pvFIhhhJMpG', '09171234510', 'LIC-DEMO-BUS', NULL, 'active', '2026-09-24 15:47:50', 0.00000000, 0.00000000, 0, 0, 0, NULL, 0.00, '2026-09-24 15:49:58'),
(5, 1, NULL, 5, 'Miguel Ramos', 'demo.driver.uv@transync.test', '$2y$10$AbZ5ckAcgRjC8COuS2RJrOZz9inA/EOzyHvUt/FKp8pvFIhhhJMpG', '09171234511', 'LIC-DEMO-UV', NULL, 'active', '2026-09-24 15:47:50', NULL, NULL, 0, 0, 0, NULL, 0.00, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `driver_quotas`
--

CREATE TABLE `driver_quotas` (
  `id` int(11) NOT NULL,
  `operator_id` int(11) NOT NULL,
  `driver_id` int(11) NOT NULL,
  `association_id` int(11) DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `frequency` enum('daily','weekly') NOT NULL DEFAULT 'daily',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `driver_quotas`
--

INSERT INTO `driver_quotas` (`id`, `operator_id`, `driver_id`, `association_id`, `amount`, `frequency`, `created_at`, `updated_at`) VALUES
(2, 1, 1, 1, 900.00, 'daily', '2026-09-24 04:44:28', '2026-09-24 04:44:28');

-- --------------------------------------------------------

--
-- Table structure for table `driver_route_quotas`
--

CREATE TABLE `driver_route_quotas` (
  `id` int(11) NOT NULL,
  `operator_id` int(11) NOT NULL,
  `route_id` int(11) NOT NULL,
  `driver_id` int(11) NOT NULL,
  `daily_quota` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `emergency_alerts`
--

CREATE TABLE `emergency_alerts` (
  `id` int(11) NOT NULL,
  `driver_id` int(11) DEFAULT NULL,
  `vehicle_id` int(11) DEFAULT NULL,
  `message` text DEFAULT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `status` enum('active','resolved') DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `fare_matrix`
--

CREATE TABLE `fare_matrix` (
  `id` int(11) NOT NULL,
  `route_id` int(11) DEFAULT NULL,
  `operator_id` int(11) DEFAULT NULL,
  `vehicle_type` enum('Jeepney','UV Express','Bus') DEFAULT NULL,
  `service_type_id` int(11) DEFAULT NULL,
  `pricing_type` enum('point_to_point','fixed') DEFAULT NULL,
  `base_fare` decimal(10,2) DEFAULT NULL,
  `per_km_rate` decimal(10,2) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `discount_student` decimal(5,2) DEFAULT 20.00,
  `discount_disabled` decimal(5,2) DEFAULT 20.00,
  `discount_elderly` decimal(5,2) DEFAULT 20.00,
  `base_km` decimal(5,2) DEFAULT 4.00,
  `succeeding_rate` decimal(6,2) DEFAULT 1.80
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `fare_matrix`
--

INSERT INTO `fare_matrix` (`id`, `route_id`, `operator_id`, `vehicle_type`, `service_type_id`, `pricing_type`, `base_fare`, `per_km_rate`, `created_at`, `discount_student`, `discount_disabled`, `discount_elderly`, `base_km`, `succeeding_rate`) VALUES
(1, 4, NULL, 'Bus', 1, 'fixed', 300.00, NULL, '2026-09-24 17:11:01', 20.00, 20.00, 20.00, 4.00, 1.80),
(2, 2, NULL, 'Bus', 1, 'fixed', 260.00, NULL, '2026-09-24 17:11:10', 20.00, 20.00, 20.00, 4.00, 1.80);

-- --------------------------------------------------------

--
-- Table structure for table `jeepney_operating_hours`
--

CREATE TABLE `jeepney_operating_hours` (
  `id` int(11) NOT NULL,
  `association_id` int(11) NOT NULL,
  `route_id` int(11) NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `jeepney_operating_hours`
--

INSERT INTO `jeepney_operating_hours` (`id`, `association_id`, `route_id`, `start_time`, `end_time`, `status`, `created_at`) VALUES
(1, 1, 1, '05:00:00', '22:00:00', 'active', '2026-09-24 16:36:37');

-- --------------------------------------------------------

--
-- Table structure for table `jeepney_quota_tiers`
--

CREATE TABLE `jeepney_quota_tiers` (
  `id` int(11) NOT NULL,
  `min_capacity` int(11) NOT NULL,
  `max_capacity` int(11) NOT NULL,
  `quota_amount` decimal(10,2) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `jeepney_quota_tiers`
--

INSERT INTO `jeepney_quota_tiers` (`id`, `min_capacity`, `max_capacity`, `quota_amount`, `updated_at`) VALUES
(1, 12, 15, 700.00, '2026-07-28 15:56:00'),
(2, 16, 19, 900.00, '2026-07-28 15:56:00'),
(3, 20, 23, 1100.00, '2026-07-28 15:56:00'),
(4, 24, 27, 1300.00, '2026-07-28 15:56:00'),
(5, 28, 32, 1500.00, '2026-07-28 15:56:00'),
(6, 33, 36, 1700.00, '2026-07-28 17:06:12');

-- --------------------------------------------------------

--
-- Table structure for table `jeepney_rides`
--

CREATE TABLE `jeepney_rides` (
  `id` int(11) NOT NULL,
  `commuter_id` int(11) NOT NULL,
  `driver_id` int(11) NOT NULL,
  `status` enum('active','completed','cancelled','dropoff_requested') DEFAULT 'active',
  `board_lat` decimal(10,8) DEFAULT NULL,
  `board_lng` decimal(11,8) DEFAULT NULL,
  `board_time` timestamp NULL DEFAULT current_timestamp(),
  `dropoff_lat` decimal(10,8) DEFAULT NULL,
  `dropoff_lng` decimal(11,8) DEFAULT NULL,
  `dropoff_time` timestamp NULL DEFAULT NULL,
  `distance_km` decimal(8,4) DEFAULT NULL,
  `fare_amount` decimal(10,2) DEFAULT NULL,
  `discount_type` enum('regular','student','disabled','elderly') DEFAULT 'regular',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `auto_end_warned_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ltfrb_fare_guides`
--

CREATE TABLE `ltfrb_fare_guides` (
  `id` int(11) NOT NULL,
  `vehicle_type` enum('Jeepney','UV Express','Bus') NOT NULL,
  `label` varchar(150) NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `updated_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `ltfrb_fare_guides`
--

INSERT INTO `ltfrb_fare_guides` (`id`, `vehicle_type`, `label`, `file_path`, `sort_order`, `updated_at`, `created_at`) VALUES
(1, 'Jeepney', 'Traditional PUJ Fare Guide', 'uploads/ltfrb_fare_guides/Fare-Guide_Traditional-PUJ-Provisional-Fare-Increase_08Oct2023.pdf', 1, NULL, '2026-08-05 16:22:56'),
(2, 'UV Express', 'UV Express Fare Guide', 'uploads/ltfrb_fare_guides/UVE-Fare-Guide.pdf', 1, NULL, '2026-08-05 16:22:56'),
(3, 'Bus', 'City - Ordinary', 'uploads/ltfrb_fare_guides/PUB-City-Ordinary.pdf', 1, NULL, '2026-08-05 16:22:56'),
(4, 'Bus', 'City - Aircon', 'uploads/ltfrb_fare_guides/PUB-City-Aircon.pdf', 2, NULL, '2026-08-05 16:22:56'),
(5, 'Bus', 'Provincial - Ordinary', 'uploads/ltfrb_fare_guides/PUB-Provincial-Ordinary.pdf', 3, NULL, '2026-08-05 16:22:56'),
(6, 'Bus', 'Provincial - Aircon (Regular)', 'uploads/ltfrb_fare_guides/PUB-Provincial-Aircon.pdf', 4, NULL, '2026-08-05 16:22:56'),
(7, 'Bus', 'Provincial - Deluxe', 'uploads/ltfrb_fare_guides/PUB-Provincial-Deluxe.pdf', 5, NULL, '2026-08-05 16:22:56'),
(8, 'Bus', 'Provincial - Super Deluxe', 'uploads/ltfrb_fare_guides/PUB-Provincial-Super-Deluxe.pdf', 6, NULL, '2026-08-05 16:22:56'),
(9, 'Bus', 'Provincial - Luxury', 'uploads/ltfrb_fare_guides/PUB-Provincial-Luxury.pdf', 7, NULL, '2026-08-05 16:22:56');

-- --------------------------------------------------------

--
-- Table structure for table `operators`
--

CREATE TABLE `operators` (
  `id` int(11) NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `first_name` varchar(50) DEFAULT NULL,
  `middle_name` varchar(50) DEFAULT NULL,
  `last_name` varchar(50) DEFAULT NULL,
  `suffix` varchar(20) DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `entity_type` enum('individual','business') DEFAULT NULL,
  `business_name` varchar(150) DEFAULT NULL,
  `business_phone` varchar(20) DEFAULT NULL,
  `business_address` varchar(255) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `registration_document_url` varchar(255) DEFAULT NULL,
  `drivers_license_url` varchar(255) DEFAULT NULL,
  `vehicle_or_cr_url` varchar(255) DEFAULT NULL,
  `business_registration_url` varchar(255) DEFAULT NULL,
  `avatar_url` varchar(255) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `operator_type` enum('Jeepney Op','UV Op','Bus Op') DEFAULT NULL,
  `association_id` int(11) DEFAULT NULL,
  `terminal_document_url` varchar(255) DEFAULT NULL,
  `route` varchar(255) DEFAULT NULL,
  `cpc_document_url` varchar(255) DEFAULT NULL,
  `ltfrb_document_url` varchar(255) DEFAULT NULL,
  `is_verified` tinyint(1) DEFAULT 0,
  `rejected_at` datetime DEFAULT NULL,
  `rejection_reason` text DEFAULT NULL,
  `status` enum('active','inactive') DEFAULT 'active',
  `wallet_balance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `remittance_mode` enum('quota','percentage') NOT NULL DEFAULT 'percentage',
  `operator_fee_pct` decimal(5,2) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `operators`
--

INSERT INTO `operators` (`id`, `name`, `first_name`, `middle_name`, `last_name`, `suffix`, `date_of_birth`, `entity_type`, `business_name`, `business_phone`, `business_address`, `email`, `password`, `registration_document_url`, `drivers_license_url`, `vehicle_or_cr_url`, `business_registration_url`, `avatar_url`, `phone`, `operator_type`, `association_id`, `terminal_document_url`, `route`, `cpc_document_url`, `ltfrb_document_url`, `is_verified`, `rejected_at`, `rejection_reason`, `status`, `wallet_balance`, `remittance_mode`, `operator_fee_pct`, `created_at`) VALUES
(1, 'Pedro Reyes', 'Pedro', NULL, 'Reyes', NULL, NULL, NULL, NULL, NULL, NULL, 'demo.operator@transync.test', '$2y$10$MkPE3on.DhGeJvBoRljC8etYITSHrlaEQ5XwB0f/9mHckfLoG/EBW', NULL, NULL, NULL, NULL, NULL, '09171234502', NULL, NULL, NULL, NULL, NULL, NULL, 1, NULL, NULL, 'active', 0.00, 'quota', NULL, '2026-08-27 01:01:55');

-- --------------------------------------------------------

--
-- Table structure for table `operator_association_applications`
--

CREATE TABLE `operator_association_applications` (
  `id` int(11) NOT NULL,
  `operator_id` int(11) NOT NULL,
  `association_id` int(11) NOT NULL,
  `vehicle_type` enum('Jeepney','UV Express','Bus') NOT NULL,
  `status` enum('pending','approved','rejected','removed') NOT NULL DEFAULT 'pending',
  `rejection_reason` varchar(255) DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `doc_lto_cr_url` varchar(255) DEFAULT NULL,
  `doc_capacity_spec_url` varchar(255) DEFAULT NULL,
  `doc_engine_cert_url` varchar(255) DEFAULT NULL,
  `doc_lto_stencil_url` varchar(255) DEFAULT NULL,
  `doc_model_proof_url` varchar(255) DEFAULT NULL,
  `doc_terminal_route_map_url` varchar(255) DEFAULT NULL,
  `doc_garage_proof_url` varchar(255) DEFAULT NULL,
  `doc_speed_limiter_url` varchar(255) DEFAULT NULL,
  `doc_gps_cert_url` varchar(255) DEFAULT NULL,
  `doc_pami_policy_url` varchar(255) DEFAULT NULL,
  `doc_fare_matrix_url` varchar(255) DEFAULT NULL,
  `intended_plate_number` varchar(20) DEFAULT NULL,
  `intended_vehicle_number` varchar(50) DEFAULT NULL,
  `intended_capacity` int(11) DEFAULT NULL,
  `vehicle_added` tinyint(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `operator_association_applications`
--

INSERT INTO `operator_association_applications` (`id`, `operator_id`, `association_id`, `vehicle_type`, `status`, `rejection_reason`, `reviewed_at`, `created_at`, `doc_lto_cr_url`, `doc_capacity_spec_url`, `doc_engine_cert_url`, `doc_lto_stencil_url`, `doc_model_proof_url`, `doc_terminal_route_map_url`, `doc_garage_proof_url`, `doc_speed_limiter_url`, `doc_gps_cert_url`, `doc_pami_policy_url`, `doc_fare_matrix_url`, `intended_plate_number`, `intended_vehicle_number`, `intended_capacity`, `vehicle_added`) VALUES
(1, 1, 1, 'Jeepney', 'approved', NULL, '2026-08-27 01:01:55', '2026-08-27 01:01:55', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1),
(2, 1, 1, 'UV Express', 'approved', NULL, '2026-09-20 11:53:18', '2026-09-20 11:53:00', 'uploads/operators/doc_lto_cr_1789905180_6aafc91cc51b5.jpg', NULL, NULL, NULL, 'uploads/operators/doc_model_proof_1789905180_6aafc91cc54a0.jpg', 'uploads/operators/doc_terminal_route_map_1789905180_6aafc91cc57d1.jpg', 'uploads/operators/doc_garage_proof_1789905180_6aafc91cc5ab9.jpg', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1),
(3, 1, 1, 'Bus', 'approved', NULL, '2026-09-24 15:47:50', '2026-09-24 15:47:50', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0);

-- --------------------------------------------------------

--
-- Table structure for table `operator_association_wallets`
--

CREATE TABLE `operator_association_wallets` (
  `id` int(11) NOT NULL,
  `operator_id` int(11) NOT NULL,
  `association_id` int(11) NOT NULL,
  `balance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `operator_association_wallets`
--

INSERT INTO `operator_association_wallets` (`id`, `operator_id`, `association_id`, `balance`, `created_at`) VALUES
(1, 1, 1, 900.00, '2026-09-24 15:33:46');

-- --------------------------------------------------------

--
-- Table structure for table `operator_class_details`
--

CREATE TABLE `operator_class_details` (
  `id` int(11) NOT NULL,
  `operator_id` int(11) NOT NULL,
  `service_type_id` int(11) NOT NULL,
  `details` text DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `paymongo_sources`
--

CREATE TABLE `paymongo_sources` (
  `id` int(11) NOT NULL,
  `source_id` varchar(255) NOT NULL COMMENT 'PayMongo source ID (src_...)',
  `commuter_id` int(11) DEFAULT NULL,
  `driver_id` int(11) DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `method` enum('gcash','paymaya') NOT NULL,
  `payment_id` varchar(255) DEFAULT NULL COMMENT 'PayMongo payment ID set after successful charge',
  `status` enum('pending','credited','failed') NOT NULL DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `paymongo_sources`
--

INSERT INTO `paymongo_sources` (`id`, `source_id`, `commuter_id`, `driver_id`, `amount`, `method`, `payment_id`, `status`, `created_at`) VALUES
(1, 'src_pvTkdb4oAHBWzAV1dfQpYVTi', 67, NULL, 1000.00, 'gcash', 'pay_WPvP3qT1y2pqweJ2RKFwT8LJ', 'credited', '2026-08-14 18:41:30'),
(2, 'src_LrzPbPWvfciLHChiomJEjCiZ', 70, NULL, 100.00, 'gcash', NULL, 'pending', '2026-08-22 01:01:31'),
(3, 'src_JnE48abheaYPt7zTVZhwhQqG', 70, NULL, 100.00, 'gcash', 'pay_zu71GCTkiUycX8L5dZd78zud', 'credited', '2026-08-22 01:01:38'),
(4, 'src_PnuqPATAwSUHxdXZwZxMqwSv', 70, NULL, 50000.00, 'gcash', 'pay_y1JU9LLZYZLvLydMZgUcJR1p', 'credited', '2026-08-22 01:03:10'),
(5, 'src_WHJ1oDon8nZt7YGywg7mRbM2', NULL, 1, 200.00, 'gcash', 'pay_65TonFBACNWEwnhrpiAiEnCL', 'credited', '2026-08-27 01:11:26'),
(6, 'src_nvbGGdDjPGfmePeC9bdAm9Ky', NULL, 1, 1000.00, 'gcash', 'pay_gcS4AHywtR3yot417hfPfqL4', 'credited', '2026-09-24 02:58:07'),
(7, 'src_fQT3nmSNMGBhZCe6yqBxGUXe', NULL, 1, 1000.00, 'gcash', 'pay_hxfny5LDb9gsaqr5eLhoMGRT', 'credited', '2026-09-24 04:44:52');

-- --------------------------------------------------------

--
-- Table structure for table `phone_otp_verifications`
--

CREATE TABLE `phone_otp_verifications` (
  `id` int(11) NOT NULL,
  `phone_number` varchar(20) NOT NULL,
  `otp_requested_at` datetime NOT NULL,
  `expires_at` datetime NOT NULL,
  `verified` tinyint(1) NOT NULL DEFAULT 0,
  `verified_at` datetime DEFAULT NULL,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `consumed_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `phone_otp_verifications`
--

INSERT INTO `phone_otp_verifications` (`id`, `phone_number`, `otp_requested_at`, `expires_at`, `verified`, `verified_at`, `attempts`, `consumed_at`, `created_at`) VALUES
(1, '09910737284', '2026-08-14 18:27:43', '2026-08-14 18:32:43', 1, '2026-08-14 18:28:48', 0, '2026-08-14 18:38:37', '2026-08-14 18:27:43'),
(2, '09346419427', '2026-08-14 19:03:31', '2026-08-14 19:08:31', 1, '2026-08-14 19:03:53', 0, NULL, '2026-08-14 19:03:31'),
(3, '09477860753', '2026-08-14 19:37:51', '2026-08-14 19:42:51', 1, '2026-08-14 19:38:21', 0, NULL, '2026-08-14 19:37:51'),
(4, '09752133529', '2026-08-17 05:53:22', '2026-08-17 05:58:22', 1, '2026-08-17 05:53:39', 0, '2026-08-17 05:59:10', '2026-08-17 05:53:22'),
(5, '09477860753', '2026-08-17 05:54:18', '2026-08-17 05:59:18', 1, '2026-08-17 05:58:45', 0, '2026-08-17 06:06:29', '2026-08-17 05:54:18'),
(6, '09477860753', '2026-08-17 06:12:27', '2026-08-17 06:17:27', 1, '2026-08-17 06:12:57', 0, NULL, '2026-08-17 06:12:27'),
(7, '09683212491', '2026-08-22 00:55:28', '2026-08-22 01:00:28', 1, '2026-08-22 00:55:53', 0, '2026-08-22 01:00:45', '2026-08-22 00:55:28'),
(8, '09477860753', '2026-08-22 01:05:15', '2026-08-22 01:10:15', 1, '2026-08-22 01:05:46', 0, NULL, '2026-08-22 01:05:15'),
(9, '09995408550', '2026-08-24 13:01:30', '2026-08-24 13:06:30', 1, '2026-08-24 13:02:57', 0, '2026-08-24 13:06:07', '2026-08-24 13:01:30'),
(10, '09241401040', '2026-08-26 11:21:26', '2026-08-26 11:26:26', 1, '2026-08-26 11:23:34', 0, '2026-08-26 11:26:36', '2026-08-26 11:21:26'),
(19, '09477860753', '2026-09-20 08:05:55', '2026-09-20 08:10:55', 0, NULL, 0, NULL, '2026-09-20 08:05:55'),
(20, '09477860753', '2026-09-20 08:17:31', '2026-09-20 08:22:31', 0, NULL, 0, NULL, '2026-09-20 08:17:31'),
(21, '09477860753', '2026-09-20 08:20:48', '2026-09-20 08:25:48', 0, NULL, 0, NULL, '2026-09-20 08:20:48'),
(22, '09477860753', '2026-09-20 08:59:14', '2026-09-20 09:04:14', 0, NULL, 0, NULL, '2026-09-20 08:59:14');

-- --------------------------------------------------------

--
-- Table structure for table `qr_boards`
--

CREATE TABLE `qr_boards` (
  `id` int(11) NOT NULL,
  `commuter_id` int(11) DEFAULT NULL,
  `qr_token` varchar(255) DEFAULT NULL,
  `status` enum('waiting','used') DEFAULT 'waiting',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `quota_submissions`
--

CREATE TABLE `quota_submissions` (
  `id` int(11) NOT NULL,
  `driver_id` int(11) NOT NULL,
  `association_id` int(11) DEFAULT NULL,
  `operator_id` int(11) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `period_type` enum('daily','weekly') NOT NULL,
  `status` enum('pending','confirmed','rejected') NOT NULL DEFAULT 'pending',
  `note` text DEFAULT NULL,
  `submitted_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `cashed_out_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `quota_submissions`
--

INSERT INTO `quota_submissions` (`id`, `driver_id`, `association_id`, `operator_id`, `amount`, `period_type`, `status`, `note`, `submitted_at`, `reviewed_at`, `cashed_out_at`) VALUES
(1, 1, 1, 1, 900.00, 'daily', 'confirmed', NULL, '2026-09-24 15:28:17', '2026-09-24 15:33:46', '2026-09-24 15:33:46');

-- --------------------------------------------------------

--
-- Table structure for table `rebook_requests`
--

CREATE TABLE `rebook_requests` (
  `id` int(11) NOT NULL,
  `reservation_id` int(11) NOT NULL,
  `commuter_id` int(11) NOT NULL,
  `reviewed_by_operator_id` int(11) DEFAULT NULL,
  `status` enum('pending','approved','rejected','fulfilled','expired') NOT NULL DEFAULT 'pending',
  `requested_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `reviewed_at` datetime DEFAULT NULL,
  `rejection_reason` varchar(255) DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `remittance_rates`
--

CREATE TABLE `remittance_rates` (
  `id` int(11) NOT NULL,
  `scope` enum('default','operator_override') NOT NULL DEFAULT 'default',
  `operator_id` int(11) DEFAULT NULL,
  `vehicle_type` enum('Bus','UV Express') NOT NULL,
  `system_fee_pct` decimal(5,2) NOT NULL,
  `operator_fee_pct` decimal(5,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `remittance_rates`
--

INSERT INTO `remittance_rates` (`id`, `scope`, `operator_id`, `vehicle_type`, `system_fee_pct`, `operator_fee_pct`, `created_at`) VALUES
(1, 'default', NULL, 'Bus', 5.00, 7.00, '2026-07-28 15:56:00'),
(2, 'default', NULL, 'UV Express', 5.00, 7.00, '2026-07-28 15:56:00');

-- --------------------------------------------------------

--
-- Table structure for table `reservations`
--

CREATE TABLE `reservations` (
  `id` int(11) NOT NULL,
  `commuter_id` int(11) NOT NULL,
  `route_id` int(11) DEFAULT NULL,
  `trip_id` int(11) DEFAULT NULL,
  `uv_session_id` int(11) DEFAULT NULL,
  `uv_slot_id` int(11) DEFAULT NULL,
  `queue_number` int(11) DEFAULT NULL,
  `legacy_trip_ref` varchar(50) DEFAULT NULL,
  `origin_terminal` varchar(150) NOT NULL,
  `destination_terminal` varchar(150) NOT NULL,
  `departure_time` datetime NOT NULL,
  `arrival_time` datetime DEFAULT NULL,
  `fare_amount` decimal(10,2) NOT NULL,
  `base_fare_amount` decimal(10,2) DEFAULT NULL,
  `payment_status` enum('held','released','refunded','forfeited') NOT NULL DEFAULT 'held',
  `system_fee_amount` decimal(10,2) DEFAULT NULL,
  `operator_fee_amount` decimal(10,2) DEFAULT NULL,
  `driver_net_amount` decimal(10,2) DEFAULT NULL,
  `rebooking_fee_amount` decimal(10,2) DEFAULT NULL,
  `discount_type` varchar(20) DEFAULT NULL,
  `passenger_name` varchar(100) NOT NULL,
  `passenger_phone` varchar(20) NOT NULL,
  `passenger_age` int(11) DEFAULT NULL,
  `seat_labels` varchar(200) DEFAULT NULL,
  `vehicle_category` varchar(50) NOT NULL,
  `passengers_count` int(11) NOT NULL DEFAULT 1,
  `status` enum('confirmed','cancelled','expired','completed') DEFAULT 'confirmed',
  `boarding_status` enum('reserved','boarded','completed','no_show','cancelled') NOT NULL DEFAULT 'reserved',
  `cancellation_type` enum('refunded','rebooked','operator_cancelled','no_show','late_cancelled') DEFAULT NULL,
  `refund_amount` decimal(10,2) DEFAULT NULL,
  `refund_pct` decimal(5,2) DEFAULT NULL,
  `rebooked_from_reservation_id` int(11) DEFAULT NULL,
  `rebooked_to_reservation_id` int(11) DEFAULT NULL,
  `boarded_at` datetime DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `boarding_driver_id` int(11) DEFAULT NULL,
  `discount_decision` enum('keep','decline','grant') DEFAULT NULL,
  `discount_source` enum('system','physical_id') DEFAULT NULL,
  `qr_code` varchar(120) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `rides`
--

CREATE TABLE `rides` (
  `id` int(11) NOT NULL,
  `driver_id` int(11) NOT NULL,
  `commuter_id` int(11) NOT NULL,
  `fare` decimal(10,2) DEFAULT 13.00,
  `discount` decimal(10,2) DEFAULT 0.00,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `status` enum('on_trip','completed','cancelled') NOT NULL DEFAULT 'on_trip',
  `boarded_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `routes`
--

CREATE TABLE `routes` (
  `id` int(11) NOT NULL,
  `operator_id` int(11) DEFAULT NULL,
  `association_id` int(11) DEFAULT NULL,
  `terminal_id` int(11) DEFAULT NULL,
  `name` varchar(100) DEFAULT NULL,
  `from_location` varchar(100) DEFAULT NULL,
  `to_location` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `vehicle_type` enum('Jeepney','UV Express','Bus') DEFAULT NULL,
  `direction_type` enum('one_way','vice_versa') NOT NULL DEFAULT 'one_way',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `has_waypoints` tinyint(1) NOT NULL DEFAULT 0,
  `color` varchar(7) NOT NULL DEFAULT '#1a4a52',
  `waypoints` longtext DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  `fare` decimal(10,2) DEFAULT NULL,
  `vehicle_count` int(11) DEFAULT NULL,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `routes`
--

INSERT INTO `routes` (`id`, `operator_id`, `association_id`, `terminal_id`, `name`, `from_location`, `to_location`, `description`, `vehicle_type`, `direction_type`, `created_at`, `has_waypoints`, `color`, `waypoints`, `updated_at`, `fare`, `vehicle_count`, `status`) VALUES
(1, NULL, 1, NULL, 'Xevera → Astro', 'Xevera', 'Astro', NULL, 'Jeepney', 'one_way', '2026-08-17 05:45:01', 1, '#0891b2', '[{\"latitude\":15.2452986,\"longitude\":120.5656453},{\"latitude\":15.2451768,\"longitude\":120.5657585},{\"latitude\":15.2450698,\"longitude\":120.5658561},{\"latitude\":15.2449824,\"longitude\":120.5659336},{\"latitude\":15.2449151,\"longitude\":120.5659942},{\"latitude\":15.2448601,\"longitude\":120.5660482},{\"latitude\":15.2447909,\"longitude\":120.5661166},{\"latitude\":15.2446877,\"longitude\":120.5662219},{\"latitude\":15.2445731,\"longitude\":120.5663313},{\"latitude\":15.2444909,\"longitude\":120.5664094},{\"latitude\":15.2444169,\"longitude\":120.5664798},{\"latitude\":15.2443205,\"longitude\":120.566566},{\"latitude\":15.2442062,\"longitude\":120.5666703},{\"latitude\":15.2441169,\"longitude\":120.5667537},{\"latitude\":15.244016,\"longitude\":120.566847},{\"latitude\":15.2439296,\"longitude\":120.5669177},{\"latitude\":15.243825,\"longitude\":120.5670035},{\"latitude\":15.2437556,\"longitude\":120.5670604},{\"latitude\":15.243696,\"longitude\":120.5671098},{\"latitude\":15.2435889,\"longitude\":120.567206},{\"latitude\":15.2435186,\"longitude\":120.5672666},{\"latitude\":15.2434649,\"longitude\":120.5673115},{\"latitude\":15.243401,\"longitude\":120.5673696},{\"latitude\":15.2431032,\"longitude\":120.5676265},{\"latitude\":15.2430495,\"longitude\":120.5676714},{\"latitude\":15.2426985,\"longitude\":120.5679304},{\"latitude\":15.2424567,\"longitude\":120.5680673},{\"latitude\":15.2423555,\"longitude\":120.5681174},{\"latitude\":15.2421713,\"longitude\":120.5681928},{\"latitude\":15.2419649,\"longitude\":120.5682648},{\"latitude\":15.2416218,\"longitude\":120.5683446},{\"latitude\":15.241121,\"longitude\":120.5684314},{\"latitude\":15.2409898,\"longitude\":120.5684252},{\"latitude\":15.2407207,\"longitude\":120.5684717},{\"latitude\":15.2404425,\"longitude\":120.5685186},{\"latitude\":15.2401757,\"longitude\":120.5685709},{\"latitude\":15.2394315,\"longitude\":120.5687037},{\"latitude\":15.2392076,\"longitude\":120.5687627},{\"latitude\":15.238989,\"longitude\":120.5688244},{\"latitude\":15.2387612,\"longitude\":120.5688794},{\"latitude\":15.2386081,\"longitude\":120.5689199},{\"latitude\":15.2384969,\"longitude\":120.5689655},{\"latitude\":15.2379659,\"longitude\":120.5691164},{\"latitude\":15.2375373,\"longitude\":120.5692439},{\"latitude\":15.2373346,\"longitude\":120.569297},{\"latitude\":15.2368934,\"longitude\":120.5695008},{\"latitude\":15.2364565,\"longitude\":120.5697239},{\"latitude\":15.2358975,\"longitude\":120.5700377},{\"latitude\":15.2355392,\"longitude\":120.5702275},{\"latitude\":15.234812,\"longitude\":120.5705735},{\"latitude\":15.2341669,\"longitude\":120.5708681},{\"latitude\":15.2336681,\"longitude\":120.5710937},{\"latitude\":15.233104,\"longitude\":120.5713391},{\"latitude\":15.2324984,\"longitude\":120.5716033},{\"latitude\":15.2319196,\"longitude\":120.5718393},{\"latitude\":15.2316405,\"longitude\":120.5719333},{\"latitude\":15.2313959,\"longitude\":120.5720111},{\"latitude\":15.2308008,\"longitude\":120.572158},{\"latitude\":15.2301578,\"longitude\":120.5722988},{\"latitude\":15.2295495,\"longitude\":120.5724417},{\"latitude\":15.2290197,\"longitude\":120.5725599},{\"latitude\":15.2284263,\"longitude\":120.5726872},{\"latitude\":15.2277789,\"longitude\":120.5728333},{\"latitude\":15.2271423,\"longitude\":120.5729794},{\"latitude\":15.226644,\"longitude\":120.5730949},{\"latitude\":15.2260484,\"longitude\":120.5732384},{\"latitude\":15.2255157,\"longitude\":120.5733905},{\"latitude\":15.224836,\"longitude\":120.5736655},{\"latitude\":15.2243313,\"longitude\":120.5738847},{\"latitude\":15.2239026,\"longitude\":120.5740617},{\"latitude\":15.2235752,\"longitude\":120.5741891},{\"latitude\":15.223247,\"longitude\":120.5743026},{\"latitude\":15.2225358,\"longitude\":120.5745529},{\"latitude\":15.2216791,\"longitude\":120.5749204},{\"latitude\":15.2208162,\"longitude\":120.5752618},{\"latitude\":15.2200512,\"longitude\":120.5755734},{\"latitude\":15.2192185,\"longitude\":120.5759049},{\"latitude\":15.2183326,\"longitude\":120.5762498},{\"latitude\":15.2176938,\"longitude\":120.5765005},{\"latitude\":15.2170086,\"longitude\":120.5767084},{\"latitude\":15.2166771,\"longitude\":120.5767996},{\"latitude\":15.216106,\"longitude\":120.5769753},{\"latitude\":15.2154977,\"longitude\":120.577159},{\"latitude\":15.2150646,\"longitude\":120.5772784},{\"latitude\":15.21477,\"longitude\":120.5773515},{\"latitude\":15.214427,\"longitude\":120.5774574},{\"latitude\":15.2134903,\"longitude\":120.5777343},{\"latitude\":15.2130123,\"longitude\":120.5778438},{\"latitude\":15.2121547,\"longitude\":120.5780646},{\"latitude\":15.2114902,\"longitude\":120.5782432},{\"latitude\":15.211097,\"longitude\":120.5783451},{\"latitude\":15.2109314,\"longitude\":120.5783934},{\"latitude\":15.2099643,\"longitude\":120.5786995},{\"latitude\":15.2090712,\"longitude\":120.5789409},{\"latitude\":15.2085122,\"longitude\":120.5790884},{\"latitude\":15.207852,\"longitude\":120.5792668},{\"latitude\":15.2072981,\"longitude\":120.5794263},{\"latitude\":15.2066394,\"longitude\":120.5796336},{\"latitude\":15.2060855,\"longitude\":120.5797931},{\"latitude\":15.2051058,\"longitude\":120.580064},{\"latitude\":15.2038167,\"longitude\":120.5804299},{\"latitude\":15.202433,\"longitude\":120.5808144},{\"latitude\":15.2015659,\"longitude\":120.5810312},{\"latitude\":15.2009155,\"longitude\":120.5811782},{\"latitude\":15.2000545,\"longitude\":120.5813723},{\"latitude\":15.1995731,\"longitude\":120.581552},{\"latitude\":15.1992185,\"longitude\":120.5816325},{\"latitude\":15.1974363,\"longitude\":120.5821004},{\"latitude\":15.1963939,\"longitude\":120.582368},{\"latitude\":15.1945718,\"longitude\":120.5828473},{\"latitude\":15.1937775,\"longitude\":120.5830976},{\"latitude\":15.1928052,\"longitude\":120.5833088},{\"latitude\":15.1920736,\"longitude\":120.5834885},{\"latitude\":15.1911267,\"longitude\":120.5837113},{\"latitude\":15.1898466,\"longitude\":120.5840385},{\"latitude\":15.1893956,\"longitude\":120.5841516},{\"latitude\":15.1876735,\"longitude\":120.5846056},{\"latitude\":15.1864549,\"longitude\":120.5849338},{\"latitude\":15.1856187,\"longitude\":120.5851486},{\"latitude\":15.1852692,\"longitude\":120.5853283},{\"latitude\":15.1837819,\"longitude\":120.5857053},{\"latitude\":15.1830884,\"longitude\":120.5858903},{\"latitude\":15.1824931,\"longitude\":120.5860566},{\"latitude\":15.181638,\"longitude\":120.5862793},{\"latitude\":15.1802896,\"longitude\":120.5866722},{\"latitude\":15.1799013,\"longitude\":120.5866561},{\"latitude\":15.1780667,\"longitude\":120.5871568},{\"latitude\":15.1773715,\"longitude\":120.5873446},{\"latitude\":15.1765043,\"longitude\":120.5875538},{\"latitude\":15.1754881,\"longitude\":120.5877531},{\"latitude\":15.1743024,\"longitude\":120.5880025},{\"latitude\":15.1734599,\"longitude\":120.5882266},{\"latitude\":15.1715018,\"longitude\":120.5887166},{\"latitude\":15.1704948,\"longitude\":120.5889981}]', '2026-09-24 23:56:18', 13.00, NULL, 'active'),
(2, 0, 1, 1, 'Dau -> Angeles', 'Dau', 'Angeles', 'Dau Terminal via MacArthur Highway, stops at Angeles City', 'Bus', 'vice_versa', '2026-09-17 17:58:10', 1, '#1a4a52', '[{\"latitude\":15.244594433052612,\"longitude\":120.57872101664543},{\"latitude\":15.244897532165988,\"longitude\":120.57959474623202},{\"latitude\":15.245216481241378,\"longitude\":120.58046512305735},{\"latitude\":15.245813619892845,\"longitude\":120.58227326720953},{\"latitude\":15.246396847393369,\"longitude\":120.58376725763083},{\"latitude\":15.247228825253522,\"longitude\":120.58573465794323},{\"latitude\":15.248617819832683,\"longitude\":120.58769468218088},{\"latitude\":15.249465638980345,\"longitude\":120.58854326605797},{\"latitude\":15.250574171103993,\"longitude\":120.58944784104823},{\"latitude\":15.251662318922486,\"longitude\":120.59017069637775}]', '2026-09-25 01:11:12', NULL, NULL, 'active'),
(3, 0, 1, 2, 'Dau -> Clark', 'Dau', 'Clark', 'Dau Terminal via Balibago and Clark Freeport Zone', 'UV Express', 'vice_versa', '2026-09-17 18:17:42', 1, '#db2777', '[{\"latitude\":15.244480568598293,\"longitude\":120.57841390371323},{\"latitude\":15.2436692825762,\"longitude\":120.57609278708695},{\"latitude\":15.2421421284257,\"longitude\":120.57180661708117},{\"latitude\":15.241236376178446,\"longitude\":120.57014767080544},{\"latitude\":15.240455485216478,\"longitude\":120.56922264397144},{\"latitude\":15.239522229372671,\"longitude\":120.56845553219318},{\"latitude\":15.236788429062962,\"longitude\":120.56729748845099},{\"latitude\":15.235610596915182,\"longitude\":120.56714426726103},{\"latitude\":15.234312418330923,\"longitude\":120.56722339242695},{\"latitude\":15.232248514631637,\"longitude\":120.56776452809574},{\"latitude\":15.229769215459868,\"longitude\":120.56844782084225}]', '2026-09-25 00:34:25', 120.00, NULL, 'active'),
(4, 0, 1, 3, 'Mabalacat -> Camachiles', 'Mabalacat', 'Camachiles', '', 'Bus', 'vice_versa', '2026-09-24 17:10:16', 1, '#d97706', '[{\"latitude\":15.19902561585291,\"longitude\":120.6037339568138},{\"latitude\":15.198933728062427,\"longitude\":120.60354050248861},{\"latitude\":15.19884507571959,\"longitude\":120.60337956994772},{\"latitude\":15.198760953024054,\"longitude\":120.60322232544422},{\"latitude\":15.198678448040054,\"longitude\":120.6030634045601},{\"latitude\":15.198524438650244,\"longitude\":120.60272946953773},{\"latitude\":15.19834454518697,\"longitude\":120.60240257531403},{\"latitude\":15.1981394146837,\"longitude\":120.6020515412092},{\"latitude\":15.1979184300224,\"longitude\":120.60164418071508},{\"latitude\":15.197831071454068,\"longitude\":120.60145709663628}]', NULL, NULL, NULL, 'active');

-- --------------------------------------------------------

--
-- Table structure for table `route_assignments`
--

CREATE TABLE `route_assignments` (
  `id` int(11) NOT NULL,
  `route_id` int(11) NOT NULL,
  `vehicle_id` int(11) DEFAULT NULL,
  `driver_id` int(11) DEFAULT NULL,
  `assigned_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `route_assignments`
--

INSERT INTO `route_assignments` (`id`, `route_id`, `vehicle_id`, `driver_id`, `assigned_at`) VALUES
(2, 1, 3, NULL, '2026-09-20 07:37:21'),
(3, 1, 1, NULL, '2026-09-20 07:39:34'),
(4, 1, 2, NULL, '2026-09-20 07:39:36'),
(5, 3, 4, NULL, '2026-09-20 19:54:56'),
(6, 3, 5, NULL, '2026-09-20 19:55:33'),
(7, 2, 6, NULL, '2026-09-24 23:47:50');

-- --------------------------------------------------------

--
-- Table structure for table `route_stopovers`
--

CREATE TABLE `route_stopovers` (
  `id` int(11) NOT NULL,
  `route_id` int(11) NOT NULL,
  `terminal_id` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `route_waypoints`
--

CREATE TABLE `route_waypoints` (
  `id` int(11) NOT NULL,
  `route_id` int(11) NOT NULL,
  `latitude` double NOT NULL,
  `longitude` double NOT NULL,
  `sequence` int(11) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `seats`
--

CREATE TABLE `seats` (
  `id` int(11) NOT NULL,
  `vehicle_id` int(11) NOT NULL,
  `seat_label` varchar(10) NOT NULL,
  `seat_row` int(11) NOT NULL,
  `seat_col` int(11) NOT NULL,
  `seat_type` enum('window','aisle','sleeper','driver','conductor','blank') NOT NULL DEFAULT 'window',
  `is_available` tinyint(1) DEFAULT 1,
  `is_blocked` tinyint(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `seats`
--

INSERT INTO `seats` (`id`, `vehicle_id`, `seat_label`, `seat_row`, `seat_col`, `seat_type`, `is_available`, `is_blocked`) VALUES
(1, 6, 'DRIVER', 0, 1, 'driver', 1, 0),
(2, 6, 'CONDUCTOR', 0, 2, 'conductor', 1, 0),
(3, 6, '1A', 1, 1, 'window', 1, 0),
(4, 6, '1B', 1, 2, 'aisle', 1, 0),
(5, 6, '1C', 1, 4, 'aisle', 1, 0),
(6, 6, '1D', 1, 5, 'window', 1, 0),
(7, 6, '1-aisle', 1, 3, 'blank', 1, 0),
(8, 6, '2A', 2, 1, 'window', 1, 0),
(9, 6, '2B', 2, 2, 'aisle', 1, 0),
(10, 6, '2C', 2, 4, 'aisle', 1, 0),
(11, 6, '2D', 2, 5, 'window', 1, 0),
(12, 6, '2-aisle', 2, 3, 'blank', 1, 0),
(13, 6, '3A', 3, 1, 'window', 1, 0),
(14, 6, '3B', 3, 2, 'aisle', 1, 0),
(15, 6, '3C', 3, 4, 'aisle', 1, 0),
(16, 6, '3D', 3, 5, 'window', 1, 0),
(17, 6, '3-aisle', 3, 3, 'blank', 1, 0),
(18, 6, '4A', 4, 1, 'window', 1, 0),
(19, 6, '4B', 4, 2, 'aisle', 1, 0),
(20, 6, '4C', 4, 4, 'aisle', 1, 0),
(21, 6, '4D', 4, 5, 'window', 1, 0),
(22, 6, '4-aisle', 4, 3, 'blank', 1, 0),
(23, 6, '5A', 5, 1, 'window', 1, 0),
(24, 6, '5B', 5, 2, 'aisle', 1, 0),
(25, 6, '5C', 5, 4, 'aisle', 1, 0),
(26, 6, '5D', 5, 5, 'window', 1, 0),
(27, 6, '5-aisle', 5, 3, 'blank', 1, 0),
(28, 6, '6A', 6, 1, 'window', 1, 0),
(29, 6, '6B', 6, 2, 'aisle', 1, 0),
(30, 6, '6C', 6, 4, 'aisle', 1, 0),
(31, 6, '6D', 6, 5, 'window', 1, 0),
(32, 6, '6-aisle', 6, 3, 'blank', 1, 0),
(33, 6, '7A', 7, 1, 'window', 1, 0),
(34, 6, '7B', 7, 2, 'aisle', 1, 0),
(35, 6, '7C', 7, 4, 'aisle', 1, 0),
(36, 6, '7D', 7, 5, 'window', 1, 0),
(37, 6, '7-aisle', 7, 3, 'blank', 1, 0),
(38, 6, '8A', 8, 1, 'window', 1, 0),
(39, 6, '8B', 8, 2, 'aisle', 1, 0),
(40, 6, '8C', 8, 4, 'aisle', 1, 0),
(41, 6, '8D', 8, 5, 'window', 1, 0),
(42, 6, '8-aisle', 8, 3, 'blank', 1, 0),
(43, 6, '9A', 9, 1, 'window', 1, 0),
(44, 6, '9B', 9, 2, 'aisle', 1, 0),
(45, 6, '9C', 9, 4, 'aisle', 1, 0),
(46, 6, '9D', 9, 5, 'window', 1, 0),
(47, 6, '9-aisle', 9, 3, 'blank', 1, 0),
(48, 6, '10A', 10, 1, 'window', 1, 0),
(49, 6, '10B', 10, 2, 'aisle', 1, 0),
(50, 6, '10C', 10, 4, 'aisle', 1, 0),
(51, 6, '10D', 10, 5, 'window', 1, 0),
(52, 6, '10-aisle', 10, 3, 'blank', 1, 0),
(53, 6, '11A', 11, 1, 'window', 1, 0),
(54, 6, '11B', 11, 2, 'aisle', 1, 0),
(55, 6, '11C', 11, 4, 'aisle', 1, 0),
(56, 6, '11D', 11, 5, 'window', 1, 0),
(57, 6, '11-aisle', 11, 3, 'blank', 1, 0),
(58, 6, '12A', 12, 1, 'window', 1, 0),
(59, 6, '12B', 12, 2, 'aisle', 1, 0),
(60, 6, '12C', 12, 4, 'aisle', 1, 0),
(61, 6, '12D', 12, 5, 'window', 1, 0),
(62, 6, '12-aisle', 12, 3, 'blank', 1, 0),
(63, 6, '13A', 13, 1, 'window', 1, 0),
(64, 6, '13B', 13, 2, 'aisle', 1, 0),
(65, 6, '13C', 13, 3, 'aisle', 1, 0),
(66, 6, '13D', 13, 4, 'aisle', 1, 0),
(67, 6, '13E', 13, 5, 'window', 1, 0);

-- --------------------------------------------------------

--
-- Table structure for table `sessions`
--

CREATE TABLE `sessions` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `token` char(64) NOT NULL,
  `owner_type` enum('commuter','driver','operator','association','admin') NOT NULL,
  `owner_id` int(10) UNSIGNED NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `sessions`
--

INSERT INTO `sessions` (`id`, `token`, `owner_type`, `owner_id`, `expires_at`, `created_at`) VALUES
(1, 'd2bbb2ba47f71f2c61552bba63e8a0581a729b9a40113372d57456b3af2c2030', 'admin', 1, '2026-08-15 19:13:47', '2026-08-15 01:13:47'),
(2, '55f71841ce67dd84b56f1e0b21d7fef83cfb22452f82b4055414a1c4dd3e8e36', 'commuter', 66, '2026-09-13 19:14:18', '2026-08-15 01:14:18'),
(3, '132da917bb2a2262225230f56517df2cee999d36ba2ad0774ee8d9ba7103dce1', 'admin', 1, '2026-08-15 17:45:22', '2026-08-14 17:45:22'),
(4, 'f0c0bf50d116c7b48aec9e24f726e14aeac4920119769c4c36a3a9a1faf0b4ce', 'admin', 1, '2026-08-15 17:49:20', '2026-08-14 17:49:20'),
(5, '8ac800a5e3ad2c10a20a903c94edc9302fbaa8cd05b121ce1606ee5e2920b6ff', 'commuter', 66, '2026-09-13 18:23:12', '2026-08-14 18:23:12'),
(6, '4ae4e0383e01d7b17bf11d1a02b4fce4d9220f9e1cba580337191b2126240262', 'commuter', 67, '2026-09-13 18:39:12', '2026-08-14 18:39:12'),
(7, '685e5691e438378a33aaed402d4b7f4ffa2ad291c0ffe57aa4fd0934a7e6199b', 'commuter', 67, '2026-09-13 19:08:40', '2026-08-14 19:08:40'),
(8, 'acd5da417913f6fa18708bb4f53b18f84e66cebdfd82ee9db2081d696d6f8baa', 'admin', 1, '2026-08-15 20:28:58', '2026-08-14 20:28:58'),
(9, '9633e2e1ba16e2021983b5f5b60cb1ac7cf615590e1e06d1036cc9a177b5ecc6', 'admin', 1, '2026-08-16 02:26:28', '2026-08-15 02:26:28'),
(10, 'b1c992a2c40e38e42ac783a0c2eab41544fcf6e5f98ce347d74b2f65e1c1e541', 'commuter', 66, '2026-09-14 03:10:03', '2026-08-15 03:10:03'),
(11, '945e1b373521f06a44278c8ca05d34588c0a3ecc8be45628f5fa5f61932e34fe', 'admin', 1, '2026-08-16 11:37:23', '2026-08-15 11:37:23'),
(12, '852e57ad7546f50597ac37bc9b4b998f4d87de4a588235e06e8affaf6e3f37fe', 'admin', 1, '2026-08-16 18:17:38', '2026-08-15 18:17:38'),
(13, '1687a89fa4cc087f9c378adc0eeb501dfe74e84e585f3b43e64fdec62a06a16b', 'admin', 1, '2026-08-17 18:23:26', '2026-08-16 18:23:26'),
(14, '0ecc52bbc9f3800a31d619abc03dbaf0e7af5df00eccc7e4b2e819fa79e8fc42', 'admin', 1, '2026-08-18 05:33:12', '2026-08-17 05:33:12'),
(15, '8296d8de197f4f790608b3b18e37aac6141d379fd08d85742bf745fde0995563', 'commuter', 68, '2026-09-16 05:59:37', '2026-08-17 05:59:37'),
(16, 'f37881bc4d514cdf19fe90088229598d5e3caf830db28d1a67b0703050c6ff8f', 'commuter', 69, '2026-09-16 06:06:47', '2026-08-17 06:06:47'),
(17, 'c70ea0dff3bb97ae2f2ef41a447c7b0571c72bc4b2b12b8173d3bba8631ad18f', 'admin', 1, '2026-08-20 16:40:20', '2026-08-19 16:40:20'),
(18, 'b5741c166965b25e33181e47de640508ff6cde429a9a0e5289ba31a1dfc48c80', 'admin', 1, '2026-08-22 14:44:48', '2026-08-21 14:44:48'),
(19, '40e518707ec373cc0bbaa0eb349d1f6ef21cb12f742c1686101a377b18a918ce', 'commuter', 70, '2026-09-21 01:01:04', '2026-08-22 01:01:04'),
(20, 'ab1332158253d2547efbaa92234c70cf8f7b210a5a0c609bed485aa32ff5b25a', 'commuter', 66, '2026-09-21 06:04:36', '2026-08-22 06:04:36'),
(21, '282973f29fb80c532cf949b588626750baf8c38bce7b37a8756115d650cd11ab', 'admin', 1, '2026-08-23 09:59:32', '2026-08-22 09:59:32'),
(22, '204b5b0ff5e5c9e09c999062757d5829e914034080195833f1418ce221a72c8d', 'commuter', 71, '2026-09-23 13:06:19', '2026-08-24 13:06:19'),
(23, '556af35398ab4e22d92c883d06a3a560da1b51906ad46266c6c8bb7ae91124a5', 'admin', 1, '2026-08-25 13:06:44', '2026-08-24 13:06:44'),
(24, '626fb5a421be387ae9742b607d2e71f33b5a53f5fe92204e4a798f2c4e4f4ec5', 'admin', 1, '2026-08-27 08:42:23', '2026-08-26 08:42:23'),
(25, 'dfcb06f54984ee87fda2b1f6a665a26117122fddb75ac351a8cd472e9411af2c', 'operator', 1, '2026-09-26 03:02:09', '2026-08-27 09:02:09'),
(26, 'ed2d049f61e2d3efd985c719d745310590bfa5420133a0ca4f788c4d68caa8a5', 'driver', 1, '2026-09-26 03:02:09', '2026-08-27 09:02:09'),
(27, '5f8c8f224759a46d14e024d4b84973a2244e9fd82c1415bb92a127179db2969e', 'driver', 2, '2026-09-26 03:02:09', '2026-08-27 09:02:09'),
(28, 'b38b0622088eaf16d23e1bb508464cf1a0bf27f6c2a4ce403bb19b1552f00ac0', 'association', 1, '2026-09-26 03:02:09', '2026-08-27 09:02:09'),
(29, '897f8ba89c2ae9d19b535046a0f418757c067dccdf419062f063d5555726aa22', 'driver', 1, '2026-09-26 03:11:14', '2026-08-27 09:11:14'),
(30, '0c5c4ed75872e1c44342c8b9aa374f1494e669b811e523ae092166488163816d', 'commuter', 73, '2026-09-26 03:17:12', '2026-08-27 09:17:12'),
(31, 'b9b2716d1ec4b4275e3cb25f23b11f9dcfb976aa07c84de47596f2cbf0ada000', 'commuter', 73, '2026-09-26 03:19:41', '2026-08-27 09:19:41'),
(32, '49520ef884a92f9f370fcbe00852e6ad6abb24dd08198a4ccca131172a811059', 'commuter', 73, '2026-09-26 03:28:58', '2026-08-27 09:28:58'),
(33, '383d440d090b759d328403cd3c11ea4729e884170fee305ddc1a22c4db54ccc8', 'association', 1, '2026-10-17 19:45:49', '2026-09-18 01:45:49'),
(34, '15400d01f12ce931912fa58eac504bd611728c2c975d3e5509fa7090f4e8c652', 'commuter', 73, '2026-10-17 20:15:13', '2026-09-18 02:15:13'),
(35, '12a23f805f21692eb7499efce062540754a014d7c38dd77a2e39e30eca6d1b6a', 'association', 1, '2026-10-17 20:15:36', '2026-09-18 02:15:36'),
(37, 'a02620cd5fc4142844b06c92cb3b120a490b7dae8dba81311f55746704dc44ed', 'commuter', 73, '2026-10-19 09:27:37', '2026-09-19 15:27:37'),
(38, '0bf01b22e54c160b7b6ade18245252dcabe800b0b1887cd902089f14220fd3ff', 'commuter', 73, '2026-10-19 09:45:19', '2026-09-19 15:45:19'),
(39, '60bcf963885bd1602ed5487432e772bf4ba74278458075fdc8c806c3234ffbab', 'operator', 1, '2026-10-19 10:59:31', '2026-09-19 16:59:31'),
(40, '276f581e79417df3c5968c3f3a0d3917da6c2ea31f5765af61504f3ae4182fb6', 'operator', 1, '2026-10-19 15:52:41', '2026-09-19 21:52:41'),
(41, 'ac0b76a3d4e7bf6aa4c6dc1d6ec6c6158c6a20015d7b40b4e08a2d46fb8f18c4', 'operator', 1, '2026-10-20 01:28:25', '2026-09-20 07:28:25'),
(42, '49291a92df91687389f8878c9710caa4f83c3766b5533653272c3c188fef48a3', 'commuter', 73, '2026-10-20 02:04:35', '2026-09-20 08:04:35'),
(43, 'edbe7da31f84a005a8753eb87b48f2bb2a5fffe2b0b759012348c403e4040b5f', 'commuter', 73, '2026-10-20 02:25:31', '2026-09-20 08:25:31'),
(44, '1fc4a4c989c5bbb556f26cfe5e3852bb7998679d2c91586cde6bf11786ce403e', 'operator', 1, '2026-10-20 02:25:59', '2026-09-20 08:25:59'),
(45, '61b69d49987ef8fab315101e3ece62e5268188858165b9c95bfba53ac26ae907', 'operator', 1, '2026-10-20 02:44:18', '2026-09-20 08:44:18'),
(46, '77c2e06999d0664003ee555b3910b9338cdb86ad17ff22824da4f1968429e432', 'operator', 1, '2026-10-20 02:59:52', '2026-09-20 08:59:52'),
(47, 'd3c58c10c5000dbfb4d29f70a372c28ed35bf51f7b4de8902d164dced535c35b', 'commuter', 73, '2026-10-20 06:25:48', '2026-09-20 12:25:48'),
(48, '0bc589298abd330cd5be2f3ce632f3a6453aec619068dcdaaf3577c28e064301', 'operator', 1, '2026-10-20 06:31:25', '2026-09-20 12:31:25'),
(49, '772e431c29e1b1897788cd065ffde38e5c1fd97aabc38413da4e30b4996376eb', 'commuter', 73, '2026-10-20 06:57:45', '2026-09-20 12:57:45'),
(50, '2fc4996e6e8376e5ded6c270004b71ac5e4ec4a18bc69b49d7a39c8dc3d71283', 'admin', 1, '2026-09-21 07:00:41', '2026-09-20 13:00:41'),
(51, '77c13656a93b6112120643106e0de66f37ca8c5e56ecee11864b863b8c8ff62a', 'commuter', 78, '2026-10-20 07:15:29', '2026-09-20 13:15:29'),
(52, 'd536cb9d783c1400b508e68cbfd53227e72c6b7b38e3549b46eaa78f47b56072', 'operator', 1, '2026-10-20 09:54:48', '2026-09-20 15:54:48'),
(53, 'cc9df03c9155105d64283e3165a5bb5bae86655b9f73859b534a2b80f2821274', 'admin', 1, '2026-09-21 10:42:43', '2026-09-20 16:42:43'),
(54, '2ac28e09a2f090f3bef2bc04f77580d6d6d8f15a9d03df8de97ea7d0d2e024e6', 'association', 1, '2026-10-20 13:53:15', '2026-09-20 19:53:15'),
(55, '11c121ce8c7f3e8a301184070d028f86422c30915e8c02b919efa686ff7eb71f', 'operator', 1, '2026-10-20 13:53:29', '2026-09-20 19:53:29'),
(56, '02c5367818d570c47f983ed6ca5d28aa465d77694ccefa0726a07f8c44c9c5f1', 'commuter', 73, '2026-10-24 04:43:59', '2026-09-24 10:43:59'),
(57, '43aa5e29bf2d4dff5e973ed307d776c9c8cff69776dba87da2e7dfa38715bc38', 'driver', 1, '2026-10-24 04:57:36', '2026-09-24 10:57:36'),
(58, '531c73f073057508a9e3cd4fec0273e221104bee1b92feb797708de79dc7ad61', 'operator', 1, '2026-10-24 17:29:45', '2026-09-24 23:29:45'),
(59, 'ac06292c4e173c197a429a18ee30fd0fce241ee54a4cbdc1c8cb15a21ee8e6c9', 'association', 1, '2026-10-24 17:35:39', '2026-09-24 23:35:39'),
(60, '78799532fc433ea56cccede520f58f6c9f88b70c3e3b6a9d45fea95388440a86', 'commuter', 73, '2026-10-24 17:39:10', '2026-09-24 23:39:10'),
(61, '0bbbc1b040e94e5f2ebf62b75d9879f0b91002abd9f42d424c9935cc3133468c', 'driver', 1, '2026-10-24 17:47:28', '2026-09-24 23:47:28'),
(62, '9bc6e2c1faff746788c2670beeff1abc336cc08d4c4b58cc65167db5c9c29e6c', 'driver', 4, '2026-10-24 17:48:03', '2026-09-24 23:48:03'),
(63, '4ce07fae32c52739450895646864115a935a4226e2c87d57ec4200e7c19c3332', 'driver', 5, '2026-10-24 17:48:04', '2026-09-24 23:48:04'),
(64, '6192f4965370416c3df29d043c2c33fb5bac863704959bb21b3de2be0050ea45', 'driver', 4, '2026-10-24 17:49:33', '2026-09-24 23:49:33'),
(65, 'd8d2783725baeba5d34d2199a5a57cdb5e126f1c42f278126a028d0ac988f05e', 'commuter', 73, '2026-10-24 17:50:23', '2026-09-24 23:50:23'),
(66, 'f789c9fe427cff334a8e380cbbed91d518ca7793c348f7f4b353ddeac4170ab1', 'operator', 1, '2026-10-24 17:53:04', '2026-09-24 23:53:04'),
(67, '402e493004617a488442b787123b2284ba77868a875ec14df5060615c3d04072', 'association', 1, '2026-10-24 17:55:41', '2026-09-24 23:55:41'),
(68, '4ec73675849ce21807b70cefb6a7503b2163e880416b5ca24e212de4ce2426ed', 'operator', 1, '2026-10-24 17:59:01', '2026-09-24 23:59:01'),
(69, 'b5d9b5d72b2cc37cd81d3eefeba85ca48a965a683cee13780c944e122a2540f5', 'commuter', 73, '2026-10-24 18:15:58', '2026-09-25 00:15:58'),
(70, '29ed57a01f536e6945431cd4ed0190f91177eea2cf27d8feeb0ab5f8b3d4d119', 'operator', 1, '2026-10-24 18:17:11', '2026-09-25 00:17:11'),
(71, '06c0e1b5cc799b6803a054e512e54e4242018f9435671b1b3c5a4f38669bcb38', 'association', 1, '2026-10-24 18:22:34', '2026-09-25 00:22:34'),
(72, '27301c9cdb4fb08f2fb9e6f5eb3d980c46d6675e81d938e1a93485935b266c27', 'commuter', 73, '2026-10-24 18:25:24', '2026-09-25 00:25:24'),
(73, 'd49ae8b65ccd364a2f2c818c2fd2e5ab4fce764304cd364a85bf9ebbde630431', 'operator', 1, '2026-10-24 18:31:26', '2026-09-25 00:31:26'),
(74, 'a0145099897266a8d2106b79998a374c1d53e7fd016b39685514f4de8207a696', 'commuter', 73, '2026-10-24 18:32:01', '2026-09-25 00:32:01'),
(75, '9e89311b0c7dad80ea59f0a771c901d9d5a1d3fbb92ad197b0d81ae855ab9fbe', 'association', 1, '2026-10-24 18:34:16', '2026-09-25 00:34:16'),
(76, '9a0545140efe57e7ccbe1a5673b54cbbbf87d94d17a3e1c7d30b10635277d8da', 'commuter', 73, '2026-10-24 18:34:47', '2026-09-25 00:34:47'),
(77, '826559737c4c0a59284a0d310d299a2ef2298db307acf0e1f3b9b102ea11b653', 'association', 1, '2026-10-24 18:36:01', '2026-09-25 00:36:01'),
(78, '8d195d232ce8a68475954567ec571f4493ad64e1feb6a07b0b5d6706164b8d1d', 'commuter', 73, '2026-10-24 18:36:55', '2026-09-25 00:36:55'),
(79, 'bf87290c4140df4daff4e15ccff66ead1b2a2c978d08bfeb3a4c92c205a2855e', 'operator', 1, '2026-10-24 18:39:53', '2026-09-25 00:39:53'),
(80, 'a73a2fb5be184ba1f114eee5010b4b109fcd5f3e66e3e5b9673ab597b9e5905e', 'operator', 1, '2026-10-24 18:44:45', '2026-09-25 00:44:45'),
(81, '796e3d41cd319ad407f0d8006f490ad10a76146593eb065d75011151f00d18ab', 'driver', 4, '2026-10-24 18:45:39', '2026-09-25 00:45:39'),
(82, 'c51b6f59dd3e492a31f94d2b63ad314ebfa7e01d0218f68e653f8e53bcc489a4', 'driver', 5, '2026-10-24 18:45:39', '2026-09-25 00:45:39'),
(83, '619b9642e1aac6e1a25bbceb720d98362a4fa67f1111b63f97ddb8fc619c59ec', 'operator', 1, '2026-10-24 18:47:20', '2026-09-25 00:47:20'),
(84, '72ae7f78cb857b6a4822ae4e50b3cd5b25fe733a087db016b54f685e01f5e438', 'association', 1, '2026-10-24 19:09:24', '2026-09-25 01:09:24');

-- --------------------------------------------------------

--
-- Table structure for table `subscription_payments`
--

CREATE TABLE `subscription_payments` (
  `id` int(11) NOT NULL,
  `driver_id` int(11) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `frequency` enum('daily','weekly','monthly') NOT NULL,
  `period_start` date NOT NULL,
  `period_end` date NOT NULL,
  `paid_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `subscription_payments`
--

INSERT INTO `subscription_payments` (`id`, `driver_id`, `amount`, `frequency`, `period_start`, `period_end`, `paid_at`) VALUES
(1, 1, 199.00, 'monthly', '2026-08-01', '2026-09-01', '2026-08-27 01:11:37'),
(2, 1, 199.00, 'monthly', '2026-09-01', '2026-10-01', '2026-09-24 02:58:21'),
(3, 1, 199.00, 'daily', '2026-09-24', '2026-09-25', '2026-09-24 04:43:17');

-- --------------------------------------------------------

--
-- Table structure for table `subscription_rates`
--

CREATE TABLE `subscription_rates` (
  `id` int(11) NOT NULL,
  `frequency` enum('daily','weekly','monthly') NOT NULL DEFAULT 'monthly',
  `amount` decimal(10,2) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `subscription_rates`
--

INSERT INTO `subscription_rates` (`id`, `frequency`, `amount`, `updated_at`) VALUES
(1, 'daily', 199.00, '2026-09-24 04:04:51');

-- --------------------------------------------------------

--
-- Table structure for table `terminals`
--

CREATE TABLE `terminals` (
  `id` int(11) NOT NULL,
  `operator_id` int(11) DEFAULT NULL,
  `association_id` int(11) DEFAULT NULL,
  `terminal_name` varchar(150) DEFAULT NULL,
  `vehicle_type` enum('Jeepney','UV Express','Bus') DEFAULT NULL,
  `location` varchar(255) DEFAULT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `route_from` varchar(100) DEFAULT NULL,
  `route_to` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `terminals`
--

INSERT INTO `terminals` (`id`, `operator_id`, `association_id`, `terminal_name`, `vehicle_type`, `location`, `latitude`, `longitude`, `route_from`, `route_to`, `created_at`) VALUES
(1, NULL, 1, 'Dau BUS', 'Bus', NULL, 15.24365634, 120.57904456, NULL, NULL, '2026-09-17 17:58:10'),
(2, NULL, 1, 'DAU UV-Express', 'UV Express', NULL, 15.24302070, 120.57918303, NULL, NULL, '2026-09-17 18:17:42'),
(3, NULL, 1, 'Mabalacat', 'Bus', NULL, 15.19786310, 120.60433377, NULL, NULL, '2026-09-24 17:10:16');

-- --------------------------------------------------------

--
-- Table structure for table `transactions`
--

CREATE TABLE `transactions` (
  `id` int(11) NOT NULL,
  `commuter_id` int(11) DEFAULT NULL,
  `booking_id` int(11) DEFAULT NULL,
  `amount` decimal(10,2) DEFAULT NULL,
  `payment_status` enum('pending','completed','failed') DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `trips`
--

CREATE TABLE `trips` (
  `id` int(11) NOT NULL,
  `route_id` int(11) NOT NULL,
  `schedule_id` int(11) DEFAULT NULL,
  `boarding_time` datetime DEFAULT NULL,
  `operator_id` int(11) DEFAULT NULL,
  `vehicle_id` int(11) DEFAULT NULL,
  `driver_id` int(11) DEFAULT NULL,
  `conductor_name` varchar(100) DEFAULT NULL,
  `conductor_phone` varchar(20) DEFAULT NULL,
  `departure_time` datetime NOT NULL,
  `fare_override` decimal(10,2) DEFAULT NULL,
  `capacity` int(11) DEFAULT NULL,
  `seats_booked` int(11) NOT NULL DEFAULT 0,
  `status` enum('pending_assignment','scheduled','boarding','departed','completed','cancelled') NOT NULL DEFAULT 'pending_assignment',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `trips`
--

INSERT INTO `trips` (`id`, `route_id`, `schedule_id`, `boarding_time`, `operator_id`, `vehicle_id`, `driver_id`, `conductor_name`, `conductor_phone`, `departure_time`, `fare_override`, `capacity`, `seats_booked`, `status`, `created_at`) VALUES
(1, 2, 1, '2026-09-25 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-09-25 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(2, 2, 1, '2026-09-26 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-09-26 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(3, 2, 1, '2026-09-27 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-09-27 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(4, 2, 1, '2026-09-28 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-09-28 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(5, 2, 1, '2026-09-29 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-09-29 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(6, 2, 1, '2026-09-30 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-09-30 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(7, 2, 1, '2026-10-01 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-01 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(8, 2, 1, '2026-10-02 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-02 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(9, 2, 1, '2026-10-03 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-03 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(10, 2, 1, '2026-10-04 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-04 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(11, 2, 1, '2026-10-05 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-05 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(12, 2, 1, '2026-10-06 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-06 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(13, 2, 1, '2026-10-07 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-07 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(14, 2, 1, '2026-10-08 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-08 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(15, 2, 1, '2026-10-09 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-09 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(16, 2, 1, '2026-10-10 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-10 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(17, 2, 1, '2026-10-11 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-11 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(18, 2, 1, '2026-10-12 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-12 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(19, 2, 1, '2026-10-13 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-13 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(20, 2, 1, '2026-10-14 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-14 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(21, 2, 1, '2026-10-15 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-15 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(22, 2, 1, '2026-10-16 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-16 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(23, 2, 1, '2026-10-17 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-17 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(24, 2, 1, '2026-10-18 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-18 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(25, 2, 1, '2026-10-19 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-19 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(26, 2, 1, '2026-10-20 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-20 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(27, 2, 1, '2026-10-21 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-21 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(28, 2, 1, '2026-10-22 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-22 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(29, 2, 1, '2026-10-23 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-23 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(30, 2, 1, '2026-10-24 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-24 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(31, 2, 1, '2026-10-25 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-25 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(32, 2, 1, '2026-10-26 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-26 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(33, 2, 1, '2026-10-27 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-27 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(34, 2, 1, '2026-10-28 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-28 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(35, 2, 1, '2026-10-29 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-29 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(36, 2, 1, '2026-10-30 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-30 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(37, 2, 1, '2026-10-31 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-31 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(38, 2, 1, '2026-11-01 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-01 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(39, 2, 1, '2026-11-02 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-02 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(40, 2, 1, '2026-11-03 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-03 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(41, 2, 1, '2026-11-04 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-04 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(42, 2, 1, '2026-11-05 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-05 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(43, 2, 1, '2026-11-06 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-06 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(44, 2, 1, '2026-11-07 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-07 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(45, 2, 1, '2026-11-08 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-08 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(46, 2, 1, '2026-11-09 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-09 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(47, 2, 1, '2026-11-10 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-10 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(48, 2, 1, '2026-11-11 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-11 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(49, 2, 1, '2026-11-12 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-12 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(50, 2, 1, '2026-11-13 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-13 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(51, 2, 1, '2026-11-14 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-14 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(52, 2, 1, '2026-11-15 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-15 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(53, 2, 1, '2026-11-16 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-16 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(54, 2, 1, '2026-11-17 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-17 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(55, 2, 1, '2026-11-18 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-18 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(56, 2, 1, '2026-11-19 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-19 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(57, 2, 1, '2026-11-20 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-20 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(58, 2, 1, '2026-11-21 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-21 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(59, 2, 1, '2026-11-22 01:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-22 02:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:35'),
(60, 2, 2, '2026-09-25 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-09-25 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(61, 2, 2, '2026-09-26 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-09-26 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(62, 2, 2, '2026-09-27 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-09-27 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(63, 2, 2, '2026-09-28 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-09-28 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(64, 2, 2, '2026-09-29 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-09-29 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(65, 2, 2, '2026-09-30 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-09-30 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(66, 2, 2, '2026-10-01 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-01 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(67, 2, 2, '2026-10-02 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-02 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(68, 2, 2, '2026-10-03 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-03 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(69, 2, 2, '2026-10-04 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-04 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(70, 2, 2, '2026-10-05 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-05 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(71, 2, 2, '2026-10-06 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-06 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(72, 2, 2, '2026-10-07 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-07 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(73, 2, 2, '2026-10-08 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-08 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(74, 2, 2, '2026-10-09 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-09 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(75, 2, 2, '2026-10-10 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-10 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(76, 2, 2, '2026-10-11 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-11 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(77, 2, 2, '2026-10-12 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-12 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(78, 2, 2, '2026-10-13 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-13 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(79, 2, 2, '2026-10-14 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-14 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(80, 2, 2, '2026-10-15 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-15 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(81, 2, 2, '2026-10-16 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-16 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(82, 2, 2, '2026-10-17 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-17 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(83, 2, 2, '2026-10-18 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-18 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(84, 2, 2, '2026-10-19 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-19 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(85, 2, 2, '2026-10-20 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-20 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(86, 2, 2, '2026-10-21 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-21 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:54'),
(87, 2, 2, '2026-10-22 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-22 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(88, 2, 2, '2026-10-23 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-23 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(89, 2, 2, '2026-10-24 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-24 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(90, 2, 2, '2026-10-25 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-25 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(91, 2, 2, '2026-10-26 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-26 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(92, 2, 2, '2026-10-27 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-27 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(93, 2, 2, '2026-10-28 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-28 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(94, 2, 2, '2026-10-29 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-29 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(95, 2, 2, '2026-10-30 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-30 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(96, 2, 2, '2026-10-31 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-31 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(97, 2, 2, '2026-11-01 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-01 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(98, 2, 2, '2026-11-02 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-02 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(99, 2, 2, '2026-11-03 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-03 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(100, 2, 2, '2026-11-04 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-04 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(101, 2, 2, '2026-11-05 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-05 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(102, 2, 2, '2026-11-06 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-06 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(103, 2, 2, '2026-11-07 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-07 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(104, 2, 2, '2026-11-08 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-08 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(105, 2, 2, '2026-11-09 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-09 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(106, 2, 2, '2026-11-10 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-10 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(107, 2, 2, '2026-11-11 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-11 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(108, 2, 2, '2026-11-12 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-12 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(109, 2, 2, '2026-11-13 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-13 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(110, 2, 2, '2026-11-14 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-14 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(111, 2, 2, '2026-11-15 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-15 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(112, 2, 2, '2026-11-16 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-16 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(113, 2, 2, '2026-11-17 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-17 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(114, 2, 2, '2026-11-18 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-18 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(115, 2, 2, '2026-11-19 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-19 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(116, 2, 2, '2026-11-20 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-20 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(117, 2, 2, '2026-11-21 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-21 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(118, 2, 2, '2026-11-22 02:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-22 04:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:11:55'),
(119, 2, 3, '2026-09-25 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-09-25 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(120, 2, 3, '2026-09-26 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-09-26 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(121, 2, 3, '2026-09-27 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-09-27 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(122, 2, 3, '2026-09-28 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-09-28 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(123, 2, 3, '2026-09-29 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-09-29 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(124, 2, 3, '2026-09-30 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-09-30 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(125, 2, 3, '2026-10-01 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-01 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(126, 2, 3, '2026-10-02 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-02 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(127, 2, 3, '2026-10-03 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-03 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(128, 2, 3, '2026-10-04 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-04 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(129, 2, 3, '2026-10-05 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-05 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(130, 2, 3, '2026-10-06 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-06 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(131, 2, 3, '2026-10-07 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-07 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(132, 2, 3, '2026-10-08 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-08 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(133, 2, 3, '2026-10-09 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-09 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(134, 2, 3, '2026-10-10 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-10 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(135, 2, 3, '2026-10-11 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-11 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(136, 2, 3, '2026-10-12 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-12 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(137, 2, 3, '2026-10-13 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-13 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(138, 2, 3, '2026-10-14 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-14 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(139, 2, 3, '2026-10-15 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-15 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(140, 2, 3, '2026-10-16 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-16 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(141, 2, 3, '2026-10-17 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-17 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(142, 2, 3, '2026-10-18 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-18 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(143, 2, 3, '2026-10-19 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-19 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(144, 2, 3, '2026-10-20 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-20 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(145, 2, 3, '2026-10-21 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-21 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(146, 2, 3, '2026-10-22 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-22 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(147, 2, 3, '2026-10-23 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-23 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(148, 2, 3, '2026-10-24 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-24 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(149, 2, 3, '2026-10-25 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-25 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(150, 2, 3, '2026-10-26 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-26 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(151, 2, 3, '2026-10-27 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-27 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(152, 2, 3, '2026-10-28 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-28 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(153, 2, 3, '2026-10-29 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-29 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(154, 2, 3, '2026-10-30 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-30 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(155, 2, 3, '2026-10-31 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-10-31 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(156, 2, 3, '2026-11-01 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-01 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(157, 2, 3, '2026-11-02 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-02 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(158, 2, 3, '2026-11-03 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-03 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(159, 2, 3, '2026-11-04 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-04 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(160, 2, 3, '2026-11-05 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-05 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(161, 2, 3, '2026-11-06 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-06 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(162, 2, 3, '2026-11-07 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-07 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(163, 2, 3, '2026-11-08 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-08 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(164, 2, 3, '2026-11-09 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-09 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(165, 2, 3, '2026-11-10 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-10 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(166, 2, 3, '2026-11-11 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-11 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(167, 2, 3, '2026-11-12 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-12 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(168, 2, 3, '2026-11-13 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-13 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(169, 2, 3, '2026-11-14 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-14 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(170, 2, 3, '2026-11-15 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-15 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(171, 2, 3, '2026-11-16 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-16 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(172, 2, 3, '2026-11-17 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-17 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(173, 2, 3, '2026-11-18 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-18 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(174, 2, 3, '2026-11-19 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-19 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(175, 2, 3, '2026-11-20 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-20 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(176, 2, 3, '2026-11-21 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-21 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(177, 2, 3, '2026-11-22 04:00:00', NULL, NULL, NULL, NULL, NULL, '2026-11-22 05:30:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:14'),
(178, 2, 4, '2026-09-25 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-09-25 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(179, 2, 4, '2026-09-26 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-09-26 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(180, 2, 4, '2026-09-27 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-09-27 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(181, 2, 4, '2026-09-28 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-09-28 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(182, 2, 4, '2026-09-29 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-09-29 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(183, 2, 4, '2026-09-30 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-09-30 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(184, 2, 4, '2026-10-01 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-01 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(185, 2, 4, '2026-10-02 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-02 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(186, 2, 4, '2026-10-03 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-03 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(187, 2, 4, '2026-10-04 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-04 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(188, 2, 4, '2026-10-05 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-05 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(189, 2, 4, '2026-10-06 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-06 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(190, 2, 4, '2026-10-07 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-07 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(191, 2, 4, '2026-10-08 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-08 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(192, 2, 4, '2026-10-09 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-09 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(193, 2, 4, '2026-10-10 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-10 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(194, 2, 4, '2026-10-11 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-11 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(195, 2, 4, '2026-10-12 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-12 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(196, 2, 4, '2026-10-13 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-13 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(197, 2, 4, '2026-10-14 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-14 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(198, 2, 4, '2026-10-15 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-15 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(199, 2, 4, '2026-10-16 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-16 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(200, 2, 4, '2026-10-17 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-17 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(201, 2, 4, '2026-10-18 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-18 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(202, 2, 4, '2026-10-19 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-19 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(203, 2, 4, '2026-10-20 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-20 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(204, 2, 4, '2026-10-21 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-21 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(205, 2, 4, '2026-10-22 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-22 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(206, 2, 4, '2026-10-23 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-23 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(207, 2, 4, '2026-10-24 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-24 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(208, 2, 4, '2026-10-25 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-25 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(209, 2, 4, '2026-10-26 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-26 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(210, 2, 4, '2026-10-27 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-27 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(211, 2, 4, '2026-10-28 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-28 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(212, 2, 4, '2026-10-29 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-29 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(213, 2, 4, '2026-10-30 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-30 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(214, 2, 4, '2026-10-31 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-10-31 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(215, 2, 4, '2026-11-01 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-01 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(216, 2, 4, '2026-11-02 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-02 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(217, 2, 4, '2026-11-03 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-03 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(218, 2, 4, '2026-11-04 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-04 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(219, 2, 4, '2026-11-05 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-05 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(220, 2, 4, '2026-11-06 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-06 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(221, 2, 4, '2026-11-07 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-07 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(222, 2, 4, '2026-11-08 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-08 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(223, 2, 4, '2026-11-09 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-09 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(224, 2, 4, '2026-11-10 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-10 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(225, 2, 4, '2026-11-11 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-11 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(226, 2, 4, '2026-11-12 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-12 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(227, 2, 4, '2026-11-13 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-13 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(228, 2, 4, '2026-11-14 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-14 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(229, 2, 4, '2026-11-15 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-15 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(230, 2, 4, '2026-11-16 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-16 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(231, 2, 4, '2026-11-17 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-17 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(232, 2, 4, '2026-11-18 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-18 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(233, 2, 4, '2026-11-19 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-19 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(234, 2, 4, '2026-11-20 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-20 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(235, 2, 4, '2026-11-21 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-21 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47'),
(236, 2, 4, '2026-11-22 05:30:00', NULL, NULL, NULL, NULL, NULL, '2026-11-22 07:00:00', NULL, NULL, 0, 'pending_assignment', '2026-09-24 17:12:47');

-- --------------------------------------------------------

--
-- Table structure for table `uv_operating_hours`
--

CREATE TABLE `uv_operating_hours` (
  `id` int(11) NOT NULL,
  `association_id` int(11) NOT NULL,
  `route_id` int(11) NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `recurrence_type` enum('daily','weekly') NOT NULL DEFAULT 'daily',
  `weekdays` varchar(20) DEFAULT NULL COMMENT '0=Sun..6=Sat, comma-separated; only used when recurrence_type=weekly',
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `uv_operating_hours`
--

INSERT INTO `uv_operating_hours` (`id`, `association_id`, `route_id`, `start_time`, `end_time`, `recurrence_type`, `weekdays`, `status`, `created_at`) VALUES
(1, 1, 3, '06:00:00', '12:00:00', 'daily', NULL, 'active', '2026-09-24 15:56:02');

-- --------------------------------------------------------

--
-- Table structure for table `uv_schedule_activations`
--

CREATE TABLE `uv_schedule_activations` (
  `id` int(11) NOT NULL,
  `operator_id` int(11) NOT NULL,
  `uv_operating_hours_id` int(11) NOT NULL,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `uv_schedule_activations`
--

INSERT INTO `uv_schedule_activations` (`id`, `operator_id`, `uv_operating_hours_id`, `status`, `created_at`) VALUES
(1, 1, 1, 'active', '2026-09-24 15:59:44');

-- --------------------------------------------------------

--
-- Table structure for table `uv_sessions`
--

CREATE TABLE `uv_sessions` (
  `id` int(11) NOT NULL,
  `driver_id` int(11) NOT NULL,
  `vehicle_id` int(11) NOT NULL,
  `route_id` int(11) NOT NULL,
  `operator_id` int(11) NOT NULL,
  `capacity` int(11) NOT NULL,
  `seats_booked` int(11) NOT NULL DEFAULT 0,
  `status` enum('open','full','departed','cancelled') NOT NULL DEFAULT 'open',
  `started_at` datetime NOT NULL,
  `ended_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `uv_slots`
--

CREATE TABLE `uv_slots` (
  `id` int(11) NOT NULL,
  `route_id` int(11) NOT NULL,
  `operator_id` int(11) DEFAULT NULL,
  `departure_time` datetime NOT NULL,
  `capacity` int(11) DEFAULT NULL,
  `seats_booked` int(11) NOT NULL DEFAULT 0,
  `status` enum('scheduled','boarding','departed','completed','cancelled') NOT NULL DEFAULT 'scheduled',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `uv_slots`
--

INSERT INTO `uv_slots` (`id`, `route_id`, `operator_id`, `departure_time`, `capacity`, `seats_booked`, `status`, `created_at`) VALUES
(1, 3, NULL, '2026-10-01 12:00:00', NULL, 0, 'scheduled', '2026-09-24 16:32:28');

-- --------------------------------------------------------

--
-- Table structure for table `vehicles`
--

CREATE TABLE `vehicles` (
  `id` int(11) NOT NULL,
  `operator_id` int(11) DEFAULT NULL,
  `association_id` int(11) DEFAULT NULL,
  `type` enum('Jeepney','UV Express','Bus') DEFAULT NULL,
  `plate_number` varchar(50) DEFAULT NULL,
  `vehicle_number` varchar(50) DEFAULT NULL,
  `bus_number` varchar(20) DEFAULT NULL,
  `service_type_id` int(11) DEFAULT NULL,
  `status` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `driver_id` int(11) DEFAULT NULL,
  `seat_config` enum('2x3','2x2','uv_standard','uv_mini') DEFAULT NULL,
  `capacity` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `vehicles`
--

INSERT INTO `vehicles` (`id`, `operator_id`, `association_id`, `type`, `plate_number`, `vehicle_number`, `bus_number`, `service_type_id`, `status`, `created_at`, `driver_id`, `seat_config`, `capacity`) VALUES
(1, 1, 1, 'Jeepney', 'DEM 001', 'V-001', NULL, NULL, 'active', '2026-08-27 01:01:55', 1, NULL, 16),
(2, 1, 1, 'Jeepney', 'DEM 002', 'V-002', NULL, NULL, 'active', '2026-08-27 01:01:55', 2, NULL, 16),
(3, 1, 1, 'Jeepney', 'DEM 003', 'V-003', NULL, NULL, 'active', '2026-09-19 23:37:21', NULL, NULL, 16),
(4, 1, 1, 'UV Express', 'ABC 1234', 'UV 01', NULL, NULL, 'active', '2026-09-20 11:54:56', 3, NULL, 15),
(5, 1, 1, 'UV Express', 'XYZ 5678', 'UV 02', NULL, NULL, 'active', '2026-09-20 11:55:33', 5, NULL, 14),
(6, 1, 1, 'Bus', 'DEM 004', 'B-001', 'B-001', 1, 'active', '2026-09-24 15:47:50', 4, NULL, 53);

-- --------------------------------------------------------

--
-- Table structure for table `wallets`
--

CREATE TABLE `wallets` (
  `id` int(11) NOT NULL,
  `commuter_id` int(11) DEFAULT NULL,
  `balance` decimal(10,2) DEFAULT 0.00,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `wallets`
--

INSERT INTO `wallets` (`id`, `commuter_id`, `balance`, `updated_at`) VALUES
(55, 66, 0.00, '2026-08-14 16:31:19'),
(56, 67, 1000.00, '2026-08-14 18:41:39'),
(57, 68, 0.00, '2026-08-17 05:59:10'),
(59, 70, 50100.00, '2026-08-22 01:03:15'),
(61, 72, 0.00, '2026-08-26 11:26:36'),
(62, 73, 1000.00, '2026-08-27 01:17:12'),
(67, 79, 0.00, '2026-09-20 05:14:44'),
(68, 78, 0.00, '2026-09-20 05:14:44');

-- --------------------------------------------------------

--
-- Table structure for table `wallet_transactions`
--

CREATE TABLE `wallet_transactions` (
  `id` int(11) NOT NULL,
  `owner_type` enum('commuter','driver','operator','system') NOT NULL,
  `owner_id` int(11) NOT NULL,
  `association_id` int(11) DEFAULT NULL,
  `type` enum('debit','credit') NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `reference_type` enum('jeepney_ride','booking','topup','refund','quota_submission','quota_refund','quota_cashout','rebooking_fee','remittance_fee','withdrawal','subscription','discount_surcharge','discount_cashback') NOT NULL,
  `reference_id` int(11) DEFAULT NULL,
  `balance_after` decimal(10,2) NOT NULL,
  `note` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `wallet_transactions`
--

INSERT INTO `wallet_transactions` (`id`, `owner_type`, `owner_id`, `association_id`, `type`, `amount`, `reference_type`, `reference_id`, `balance_after`, `note`, `created_at`) VALUES
(1, 'commuter', 67, NULL, 'credit', 1000.00, 'topup', NULL, 1000.00, 'Top up via GCash (Demo) ₱1,000.00', '2026-08-14 18:41:39'),
(2, 'commuter', 70, NULL, 'credit', 100.00, 'topup', NULL, 100.00, 'Top up via GCash (Demo) ₱100.00', '2026-08-22 01:01:46'),
(3, 'commuter', 70, NULL, 'credit', 50000.00, 'topup', NULL, 50100.00, 'Top up via GCash (Demo) ₱50,000.00', '2026-08-22 01:03:15'),
(4, 'driver', 1, NULL, 'credit', 200.00, 'topup', NULL, 200.00, 'Top up via GCash (Demo) ₱200.00', '2026-08-27 01:11:36'),
(5, 'driver', 1, NULL, 'debit', 199.00, 'subscription', NULL, 1.00, 'Platform quota (monthly)', '2026-08-27 01:11:37'),
(6, 'system', 0, NULL, 'credit', 199.00, 'subscription', NULL, 199.00, 'Jeepney quota — driver #1', '2026-08-27 01:11:37'),
(7, 'driver', 1, NULL, 'credit', 1000.00, 'topup', NULL, 1001.00, 'Top up via GCash (Demo) ₱1,000.00', '2026-09-24 02:58:19'),
(8, 'driver', 1, NULL, 'debit', 199.00, 'subscription', NULL, 802.00, 'Platform quota (monthly)', '2026-09-24 02:58:21'),
(9, 'system', 0, NULL, 'credit', 199.00, 'subscription', NULL, 199.00, 'Jeepney quota — driver #1', '2026-09-24 02:58:21'),
(10, 'driver', 1, NULL, 'debit', 199.00, 'subscription', NULL, 603.00, 'Platform quota (daily)', '2026-09-24 04:43:17'),
(11, 'system', 0, NULL, 'credit', 199.00, 'subscription', NULL, 199.00, 'Jeepney quota — driver #1', '2026-09-24 04:43:17'),
(12, 'driver', 1, NULL, 'credit', 1000.00, 'topup', NULL, 1603.00, 'Top up via GCash (Demo) ₱1,000.00', '2026-09-24 04:46:48'),
(13, 'driver', 1, NULL, 'debit', 900.00, 'quota_submission', 1, 703.00, 'Quota remittance', '2026-09-24 15:28:17'),
(14, 'operator', 1, 1, 'credit', 900.00, 'quota_cashout', 1, 900.00, 'Quota confirmed — driver #1', '2026-09-24 15:33:46');

-- --------------------------------------------------------

--
-- Table structure for table `withdrawal_requests`
--

CREATE TABLE `withdrawal_requests` (
  `id` int(11) NOT NULL,
  `owner_type` enum('operator','driver') NOT NULL DEFAULT 'operator',
  `operator_id` int(11) DEFAULT NULL,
  `driver_id` int(11) DEFAULT NULL,
  `association_id` int(11) DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `status` enum('pending','paid','rejected') NOT NULL DEFAULT 'pending',
  `requested_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `resolved_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `admins`
--
ALTER TABLE `admins`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`);

--
-- Indexes for table `associations`
--
ALTER TABLE `associations`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `contact_email` (`contact_email`);

--
-- Indexes for table `association_applications`
--
ALTER TABLE `association_applications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_subject` (`subject_type`,`subject_id`),
  ADD KEY `idx_operator` (`operator_id`),
  ADD KEY `idx_association` (`association_id`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `aa_reviewer_fk` (`reviewed_by`);

--
-- Indexes for table `association_memberships`
--
ALTER TABLE `association_memberships`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_active_subject` (`subject_type`,`subject_id`,`status`),
  ADD KEY `idx_association` (`association_id`),
  ADD KEY `idx_operator` (`operator_id`),
  ADD KEY `idx_application` (`application_id`);

--
-- Indexes for table `bookings`
--
ALTER TABLE `bookings`
  ADD PRIMARY KEY (`id`),
  ADD KEY `commuter_id` (`commuter_id`),
  ADD KEY `vehicle_id` (`vehicle_id`),
  ADD KEY `route_id` (`route_id`),
  ADD KEY `seat_id` (`seat_id`),
  ADD KEY `driver_id` (`driver_id`);

--
-- Indexes for table `bus_layout_templates`
--
ALTER TABLE `bus_layout_templates`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_blt_operator` (`operator_id`),
  ADD KEY `idx_blt_service_type` (`service_type_id`);

--
-- Indexes for table `bus_layout_template_seats`
--
ALTER TABLE `bus_layout_template_seats`
  ADD PRIMARY KEY (`id`),
  ADD KEY `template_id` (`template_id`);

--
-- Indexes for table `bus_schedules`
--
ALTER TABLE `bus_schedules`
  ADD PRIMARY KEY (`id`),
  ADD KEY `association_id` (`association_id`),
  ADD KEY `route_id` (`route_id`),
  ADD KEY `service_type_id` (`service_type_id`);

--
-- Indexes for table `bus_service_types`
--
ALTER TABLE `bus_service_types`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_association_service_name` (`association_id`,`name`),
  ADD KEY `idx_bst_operator_id` (`operator_id`);

--
-- Indexes for table `commuters`
--
ALTER TABLE `commuters`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`);

--
-- Indexes for table `commuter_id_verifications`
--
ALTER TABLE `commuter_id_verifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_civ_commuter` (`commuter_id`),
  ADD KEY `idx_civ_student_id_number` (`student_id_number`),
  ADD KEY `idx_civ_id_number` (`id_number`);

--
-- Indexes for table `consent_acceptances`
--
ALTER TABLE `consent_acceptances`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_consent_account` (`account_type`,`account_id`);

--
-- Indexes for table `dispatch_queue`
--
ALTER TABLE `dispatch_queue`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_operator_status` (`operator_id`,`status`),
  ADD KEY `idx_driver_status` (`driver_id`,`status`),
  ADD KEY `idx_dispatch_route_status` (`route_id`,`status`);

--
-- Indexes for table `drivers`
--
ALTER TABLE `drivers`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `operator_id` (`operator_id`),
  ADD KEY `vehicle_id` (`vehicle_id`),
  ADD KEY `drivers_association_fk` (`association_id`);

--
-- Indexes for table `driver_quotas`
--
ALTER TABLE `driver_quotas`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_driver_quota` (`driver_id`),
  ADD KEY `operator_id` (`operator_id`),
  ADD KEY `fk_driver_quotas_association` (`association_id`);

--
-- Indexes for table `driver_route_quotas`
--
ALTER TABLE `driver_route_quotas`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_route_driver_quota` (`route_id`,`driver_id`),
  ADD KEY `operator_id` (`operator_id`),
  ADD KEY `driver_id` (`driver_id`);

--
-- Indexes for table `emergency_alerts`
--
ALTER TABLE `emergency_alerts`
  ADD PRIMARY KEY (`id`),
  ADD KEY `driver_id` (`driver_id`),
  ADD KEY `vehicle_id` (`vehicle_id`);

--
-- Indexes for table `fare_matrix`
--
ALTER TABLE `fare_matrix`
  ADD PRIMARY KEY (`id`),
  ADD KEY `route_id` (`route_id`),
  ADD KEY `operator_id` (`operator_id`),
  ADD KEY `fk_farematrix_service_type` (`service_type_id`);

--
-- Indexes for table `jeepney_operating_hours`
--
ALTER TABLE `jeepney_operating_hours`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_jeepney_route_hours` (`route_id`),
  ADD KEY `association_id` (`association_id`);

--
-- Indexes for table `jeepney_quota_tiers`
--
ALTER TABLE `jeepney_quota_tiers`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `jeepney_rides`
--
ALTER TABLE `jeepney_rides`
  ADD PRIMARY KEY (`id`),
  ADD KEY `commuter_id` (`commuter_id`),
  ADD KEY `driver_id` (`driver_id`);

--
-- Indexes for table `ltfrb_fare_guides`
--
ALTER TABLE `ltfrb_fare_guides`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `operators`
--
ALTER TABLE `operators`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `idx_operator_association` (`association_id`);

--
-- Indexes for table `operator_association_applications`
--
ALTER TABLE `operator_association_applications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_opassoc_operator` (`operator_id`,`status`),
  ADD KEY `idx_opassoc_association` (`association_id`,`status`);

--
-- Indexes for table `operator_association_wallets`
--
ALTER TABLE `operator_association_wallets`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_operator_association` (`operator_id`,`association_id`),
  ADD KEY `association_id` (`association_id`);

--
-- Indexes for table `operator_class_details`
--
ALTER TABLE `operator_class_details`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_operator_class` (`operator_id`,`service_type_id`),
  ADD KEY `service_type_id` (`service_type_id`);

--
-- Indexes for table `paymongo_sources`
--
ALTER TABLE `paymongo_sources`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `source_id` (`source_id`),
  ADD KEY `commuter_id` (`commuter_id`),
  ADD KEY `fk_paymongo_sources_driver` (`driver_id`);

--
-- Indexes for table `phone_otp_verifications`
--
ALTER TABLE `phone_otp_verifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_phone_otp_phone_number` (`phone_number`);

--
-- Indexes for table `qr_boards`
--
ALTER TABLE `qr_boards`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `quota_submissions`
--
ALTER TABLE `quota_submissions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `driver_id` (`driver_id`),
  ADD KEY `operator_id` (`operator_id`),
  ADD KEY `fk_quota_submissions_association` (`association_id`);

--
-- Indexes for table `rebook_requests`
--
ALTER TABLE `rebook_requests`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_pending_per_reservation` (`reservation_id`,`status`),
  ADD KEY `idx_reservation` (`reservation_id`),
  ADD KEY `idx_commuter` (`commuter_id`),
  ADD KEY `fk_rebook_requests_operator` (`reviewed_by_operator_id`);

--
-- Indexes for table `remittance_rates`
--
ALTER TABLE `remittance_rates`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_default_rate` (`scope`,`vehicle_type`,`operator_id`),
  ADD KEY `operator_id` (`operator_id`);

--
-- Indexes for table `reservations`
--
ALTER TABLE `reservations`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `qr_code` (`qr_code`),
  ADD UNIQUE KEY `unique_trip_seat` (`trip_id`,`seat_labels`),
  ADD KEY `commuter_id` (`commuter_id`),
  ADD KEY `idx_res_trip` (`trip_id`),
  ADD KEY `idx_res_uv` (`uv_session_id`),
  ADD KEY `idx_res_uv_slot` (`uv_slot_id`),
  ADD KEY `idx_res_payment_status` (`payment_status`),
  ADD KEY `fk_res_rebook_from` (`rebooked_from_reservation_id`),
  ADD KEY `fk_res_rebook_to` (`rebooked_to_reservation_id`),
  ADD KEY `idx_res_boarding_driver` (`boarding_driver_id`);

--
-- Indexes for table `rides`
--
ALTER TABLE `rides`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `routes`
--
ALTER TABLE `routes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_operator` (`operator_id`),
  ADD KEY `idx_routes_association` (`association_id`),
  ADD KEY `fk_route_terminal` (`terminal_id`);

--
-- Indexes for table `route_assignments`
--
ALTER TABLE `route_assignments`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_driver` (`driver_id`),
  ADD UNIQUE KEY `unique_vehicle` (`vehicle_id`),
  ADD KEY `idx_route` (`route_id`);

--
-- Indexes for table `route_stopovers`
--
ALTER TABLE `route_stopovers`
  ADD PRIMARY KEY (`id`),
  ADD KEY `terminal_id` (`terminal_id`),
  ADD KEY `idx_stopover_route` (`route_id`);

--
-- Indexes for table `route_waypoints`
--
ALTER TABLE `route_waypoints`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_route_seq` (`route_id`,`sequence`);

--
-- Indexes for table `seats`
--
ALTER TABLE `seats`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_vehicle_seat` (`vehicle_id`,`seat_label`),
  ADD KEY `vehicle_id` (`vehicle_id`);

--
-- Indexes for table `sessions`
--
ALTER TABLE `sessions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uk_token` (`token`),
  ADD KEY `idx_owner` (`owner_type`,`owner_id`);

--
-- Indexes for table `subscription_payments`
--
ALTER TABLE `subscription_payments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `driver_id` (`driver_id`);

--
-- Indexes for table `subscription_rates`
--
ALTER TABLE `subscription_rates`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `terminals`
--
ALTER TABLE `terminals`
  ADD PRIMARY KEY (`id`),
  ADD KEY `operator_id` (`operator_id`),
  ADD KEY `fk_terminal_association` (`association_id`);

--
-- Indexes for table `transactions`
--
ALTER TABLE `transactions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `commuter_id` (`commuter_id`),
  ADD KEY `booking_id` (`booking_id`);

--
-- Indexes for table `trips`
--
ALTER TABLE `trips`
  ADD PRIMARY KEY (`id`),
  ADD KEY `operator_id` (`operator_id`),
  ADD KEY `vehicle_id` (`vehicle_id`),
  ADD KEY `driver_id` (`driver_id`),
  ADD KEY `idx_trips_route_dep` (`route_id`,`departure_time`),
  ADD KEY `idx_trips_status` (`status`),
  ADD KEY `fk_trips_schedule` (`schedule_id`);

--
-- Indexes for table `uv_operating_hours`
--
ALTER TABLE `uv_operating_hours`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_route_hours` (`route_id`),
  ADD KEY `association_id` (`association_id`);

--
-- Indexes for table `uv_schedule_activations`
--
ALTER TABLE `uv_schedule_activations`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_operator_schedule` (`operator_id`,`uv_operating_hours_id`),
  ADD KEY `uv_operating_hours_id` (`uv_operating_hours_id`);

--
-- Indexes for table `uv_sessions`
--
ALTER TABLE `uv_sessions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `vehicle_id` (`vehicle_id`),
  ADD KEY `route_id` (`route_id`),
  ADD KEY `operator_id` (`operator_id`),
  ADD KEY `idx_uv_status` (`status`),
  ADD KEY `idx_uv_driver` (`driver_id`);

--
-- Indexes for table `uv_slots`
--
ALTER TABLE `uv_slots`
  ADD PRIMARY KEY (`id`),
  ADD KEY `operator_id` (`operator_id`),
  ADD KEY `idx_slots_route_dep` (`route_id`,`departure_time`),
  ADD KEY `idx_slots_status` (`status`);

--
-- Indexes for table `vehicles`
--
ALTER TABLE `vehicles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `plate_number` (`plate_number`),
  ADD KEY `operator_id` (`operator_id`),
  ADD KEY `driver_id` (`driver_id`),
  ADD KEY `vehicles_association_fk` (`association_id`),
  ADD KEY `fk_vehicle_service_type` (`service_type_id`);

--
-- Indexes for table `wallets`
--
ALTER TABLE `wallets`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `commuter_id` (`commuter_id`);

--
-- Indexes for table `wallet_transactions`
--
ALTER TABLE `wallet_transactions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `owner` (`owner_type`,`owner_id`),
  ADD KEY `fk_wallet_transactions_association` (`association_id`);

--
-- Indexes for table `withdrawal_requests`
--
ALTER TABLE `withdrawal_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `operator_id` (`operator_id`),
  ADD KEY `fk_withdrawal_requests_association` (`association_id`),
  ADD KEY `fk_withdrawal_requests_driver` (`driver_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `admins`
--
ALTER TABLE `admins`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `associations`
--
ALTER TABLE `associations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `association_applications`
--
ALTER TABLE `association_applications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `association_memberships`
--
ALTER TABLE `association_memberships`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `bookings`
--
ALTER TABLE `bookings`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `bus_layout_templates`
--
ALTER TABLE `bus_layout_templates`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `bus_layout_template_seats`
--
ALTER TABLE `bus_layout_template_seats`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `bus_schedules`
--
ALTER TABLE `bus_schedules`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `bus_service_types`
--
ALTER TABLE `bus_service_types`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `commuters`
--
ALTER TABLE `commuters`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=80;

--
-- AUTO_INCREMENT for table `commuter_id_verifications`
--
ALTER TABLE `commuter_id_verifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=47;

--
-- AUTO_INCREMENT for table `consent_acceptances`
--
ALTER TABLE `consent_acceptances`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=28;

--
-- AUTO_INCREMENT for table `dispatch_queue`
--
ALTER TABLE `dispatch_queue`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `drivers`
--
ALTER TABLE `drivers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `driver_quotas`
--
ALTER TABLE `driver_quotas`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `driver_route_quotas`
--
ALTER TABLE `driver_route_quotas`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `emergency_alerts`
--
ALTER TABLE `emergency_alerts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `fare_matrix`
--
ALTER TABLE `fare_matrix`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `jeepney_operating_hours`
--
ALTER TABLE `jeepney_operating_hours`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `jeepney_quota_tiers`
--
ALTER TABLE `jeepney_quota_tiers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `jeepney_rides`
--
ALTER TABLE `jeepney_rides`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ltfrb_fare_guides`
--
ALTER TABLE `ltfrb_fare_guides`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- AUTO_INCREMENT for table `operators`
--
ALTER TABLE `operators`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `operator_association_applications`
--
ALTER TABLE `operator_association_applications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `operator_association_wallets`
--
ALTER TABLE `operator_association_wallets`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `operator_class_details`
--
ALTER TABLE `operator_class_details`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `paymongo_sources`
--
ALTER TABLE `paymongo_sources`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `phone_otp_verifications`
--
ALTER TABLE `phone_otp_verifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=23;

--
-- AUTO_INCREMENT for table `qr_boards`
--
ALTER TABLE `qr_boards`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `quota_submissions`
--
ALTER TABLE `quota_submissions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `rebook_requests`
--
ALTER TABLE `rebook_requests`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `remittance_rates`
--
ALTER TABLE `remittance_rates`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `reservations`
--
ALTER TABLE `reservations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `rides`
--
ALTER TABLE `rides`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `routes`
--
ALTER TABLE `routes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `route_assignments`
--
ALTER TABLE `route_assignments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `route_stopovers`
--
ALTER TABLE `route_stopovers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `route_waypoints`
--
ALTER TABLE `route_waypoints`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `seats`
--
ALTER TABLE `seats`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=68;

--
-- AUTO_INCREMENT for table `sessions`
--
ALTER TABLE `sessions`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=85;

--
-- AUTO_INCREMENT for table `subscription_payments`
--
ALTER TABLE `subscription_payments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `subscription_rates`
--
ALTER TABLE `subscription_rates`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `terminals`
--
ALTER TABLE `terminals`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `transactions`
--
ALTER TABLE `transactions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `trips`
--
ALTER TABLE `trips`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=237;

--
-- AUTO_INCREMENT for table `uv_operating_hours`
--
ALTER TABLE `uv_operating_hours`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `uv_schedule_activations`
--
ALTER TABLE `uv_schedule_activations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `uv_sessions`
--
ALTER TABLE `uv_sessions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `uv_slots`
--
ALTER TABLE `uv_slots`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `vehicles`
--
ALTER TABLE `vehicles`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `wallets`
--
ALTER TABLE `wallets`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=69;

--
-- AUTO_INCREMENT for table `wallet_transactions`
--
ALTER TABLE `wallet_transactions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=17;

--
-- AUTO_INCREMENT for table `withdrawal_requests`
--
ALTER TABLE `withdrawal_requests`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `association_applications`
--
ALTER TABLE `association_applications`
  ADD CONSTRAINT `aa_association_fk` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `aa_operator_fk` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `aa_reviewer_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `associations` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `association_memberships`
--
ALTER TABLE `association_memberships`
  ADD CONSTRAINT `am_application_fk` FOREIGN KEY (`application_id`) REFERENCES `association_applications` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `am_association_fk` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `am_operator_fk` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `bookings`
--
ALTER TABLE `bookings`
  ADD CONSTRAINT `bookings_ibfk_1` FOREIGN KEY (`commuter_id`) REFERENCES `commuters` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `bookings_ibfk_2` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `bookings_ibfk_3` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `bookings_ibfk_4` FOREIGN KEY (`seat_id`) REFERENCES `seats` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `bookings_ibfk_5` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `bus_layout_templates`
--
ALTER TABLE `bus_layout_templates`
  ADD CONSTRAINT `bus_layout_templates_ibfk_1` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `bus_layout_templates_ibfk_2` FOREIGN KEY (`service_type_id`) REFERENCES `bus_service_types` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `bus_layout_template_seats`
--
ALTER TABLE `bus_layout_template_seats`
  ADD CONSTRAINT `bus_layout_template_seats_ibfk_1` FOREIGN KEY (`template_id`) REFERENCES `bus_layout_templates` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `bus_schedules`
--
ALTER TABLE `bus_schedules`
  ADD CONSTRAINT `bus_schedules_ibfk_1` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `bus_schedules_ibfk_2` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `bus_schedules_ibfk_3` FOREIGN KEY (`service_type_id`) REFERENCES `bus_service_types` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `bus_service_types`
--
ALTER TABLE `bus_service_types`
  ADD CONSTRAINT `bus_service_types_ibfk_1` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_bst_association` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `commuter_id_verifications`
--
ALTER TABLE `commuter_id_verifications`
  ADD CONSTRAINT `fk_civ_commuter` FOREIGN KEY (`commuter_id`) REFERENCES `commuters` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `dispatch_queue`
--
ALTER TABLE `dispatch_queue`
  ADD CONSTRAINT `dispatch_queue_ibfk_1` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `dispatch_queue_ibfk_2` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_dispatch_route` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `drivers`
--
ALTER TABLE `drivers`
  ADD CONSTRAINT `drivers_association_fk` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `drivers_ibfk_1` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `drivers_ibfk_2` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `driver_quotas`
--
ALTER TABLE `driver_quotas`
  ADD CONSTRAINT `driver_quotas_ibfk_1` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `driver_quotas_ibfk_2` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_driver_quotas_association` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `driver_route_quotas`
--
ALTER TABLE `driver_route_quotas`
  ADD CONSTRAINT `driver_route_quotas_ibfk_1` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `driver_route_quotas_ibfk_2` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `driver_route_quotas_ibfk_3` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `emergency_alerts`
--
ALTER TABLE `emergency_alerts`
  ADD CONSTRAINT `emergency_alerts_ibfk_1` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `emergency_alerts_ibfk_2` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `fare_matrix`
--
ALTER TABLE `fare_matrix`
  ADD CONSTRAINT `fare_matrix_ibfk_1` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fare_matrix_ibfk_2` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_farematrix_service_type` FOREIGN KEY (`service_type_id`) REFERENCES `bus_service_types` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `jeepney_operating_hours`
--
ALTER TABLE `jeepney_operating_hours`
  ADD CONSTRAINT `jeepney_operating_hours_ibfk_1` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `jeepney_operating_hours_ibfk_2` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `jeepney_rides`
--
ALTER TABLE `jeepney_rides`
  ADD CONSTRAINT `jeepney_rides_ibfk_1` FOREIGN KEY (`commuter_id`) REFERENCES `commuters` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `jeepney_rides_ibfk_2` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `operators`
--
ALTER TABLE `operators`
  ADD CONSTRAINT `fk_operator_association` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `operator_association_applications`
--
ALTER TABLE `operator_association_applications`
  ADD CONSTRAINT `operator_association_applications_ibfk_1` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `operator_association_applications_ibfk_2` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `operator_association_wallets`
--
ALTER TABLE `operator_association_wallets`
  ADD CONSTRAINT `operator_association_wallets_ibfk_1` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `operator_association_wallets_ibfk_2` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `operator_class_details`
--
ALTER TABLE `operator_class_details`
  ADD CONSTRAINT `operator_class_details_ibfk_1` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `operator_class_details_ibfk_2` FOREIGN KEY (`service_type_id`) REFERENCES `bus_service_types` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `paymongo_sources`
--
ALTER TABLE `paymongo_sources`
  ADD CONSTRAINT `fk_paymongo_sources_driver` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `paymongo_sources_ibfk_1` FOREIGN KEY (`commuter_id`) REFERENCES `commuters` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `quota_submissions`
--
ALTER TABLE `quota_submissions`
  ADD CONSTRAINT `fk_quota_submissions_association` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `quota_submissions_ibfk_1` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `quota_submissions_ibfk_2` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `rebook_requests`
--
ALTER TABLE `rebook_requests`
  ADD CONSTRAINT `fk_rebook_requests_commuter` FOREIGN KEY (`commuter_id`) REFERENCES `commuters` (`id`),
  ADD CONSTRAINT `fk_rebook_requests_operator` FOREIGN KEY (`reviewed_by_operator_id`) REFERENCES `operators` (`id`),
  ADD CONSTRAINT `fk_rebook_requests_reservation` FOREIGN KEY (`reservation_id`) REFERENCES `reservations` (`id`);

--
-- Constraints for table `remittance_rates`
--
ALTER TABLE `remittance_rates`
  ADD CONSTRAINT `remittance_rates_ibfk_1` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `reservations`
--
ALTER TABLE `reservations`
  ADD CONSTRAINT `fk_res_boarding_driver` FOREIGN KEY (`boarding_driver_id`) REFERENCES `drivers` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_res_rebook_from` FOREIGN KEY (`rebooked_from_reservation_id`) REFERENCES `reservations` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_res_rebook_to` FOREIGN KEY (`rebooked_to_reservation_id`) REFERENCES `reservations` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_res_trip` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_res_uv` FOREIGN KEY (`uv_session_id`) REFERENCES `uv_sessions` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_res_uv_slot` FOREIGN KEY (`uv_slot_id`) REFERENCES `uv_slots` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `reservations_ibfk_1` FOREIGN KEY (`commuter_id`) REFERENCES `commuters` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `routes`
--
ALTER TABLE `routes`
  ADD CONSTRAINT `fk_route_terminal` FOREIGN KEY (`terminal_id`) REFERENCES `terminals` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `routes_association_fk` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `route_assignments`
--
ALTER TABLE `route_assignments`
  ADD CONSTRAINT `fk_route_assignments_vehicle` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `route_assignments_ibfk_1` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `route_assignments_ibfk_2` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `route_stopovers`
--
ALTER TABLE `route_stopovers`
  ADD CONSTRAINT `route_stopovers_ibfk_1` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `route_stopovers_ibfk_2` FOREIGN KEY (`terminal_id`) REFERENCES `terminals` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `route_waypoints`
--
ALTER TABLE `route_waypoints`
  ADD CONSTRAINT `route_waypoints_ibfk_1` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `seats`
--
ALTER TABLE `seats`
  ADD CONSTRAINT `seats_ibfk_1` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `subscription_payments`
--
ALTER TABLE `subscription_payments`
  ADD CONSTRAINT `subscription_payments_ibfk_1` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `terminals`
--
ALTER TABLE `terminals`
  ADD CONSTRAINT `fk_terminal_association` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `terminals_ibfk_1` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `transactions`
--
ALTER TABLE `transactions`
  ADD CONSTRAINT `transactions_ibfk_1` FOREIGN KEY (`commuter_id`) REFERENCES `commuters` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `transactions_ibfk_2` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `trips`
--
ALTER TABLE `trips`
  ADD CONSTRAINT `fk_trips_schedule` FOREIGN KEY (`schedule_id`) REFERENCES `bus_schedules` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `trips_ibfk_1` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `trips_ibfk_2` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `trips_ibfk_3` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `trips_ibfk_4` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `uv_operating_hours`
--
ALTER TABLE `uv_operating_hours`
  ADD CONSTRAINT `uv_operating_hours_ibfk_1` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `uv_operating_hours_ibfk_2` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `uv_schedule_activations`
--
ALTER TABLE `uv_schedule_activations`
  ADD CONSTRAINT `uv_schedule_activations_ibfk_1` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `uv_schedule_activations_ibfk_2` FOREIGN KEY (`uv_operating_hours_id`) REFERENCES `uv_operating_hours` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `uv_sessions`
--
ALTER TABLE `uv_sessions`
  ADD CONSTRAINT `uv_sessions_ibfk_1` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `uv_sessions_ibfk_2` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `uv_sessions_ibfk_3` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `uv_sessions_ibfk_4` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `uv_slots`
--
ALTER TABLE `uv_slots`
  ADD CONSTRAINT `uv_slots_ibfk_1` FOREIGN KEY (`route_id`) REFERENCES `routes` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `uv_slots_ibfk_2` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `vehicles`
--
ALTER TABLE `vehicles`
  ADD CONSTRAINT `fk_vehicle_service_type` FOREIGN KEY (`service_type_id`) REFERENCES `bus_service_types` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `vehicles_association_fk` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `vehicles_ibfk_1` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `vehicles_ibfk_2` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `wallets`
--
ALTER TABLE `wallets`
  ADD CONSTRAINT `wallets_ibfk_1` FOREIGN KEY (`commuter_id`) REFERENCES `commuters` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `wallet_transactions`
--
ALTER TABLE `wallet_transactions`
  ADD CONSTRAINT `fk_wallet_transactions_association` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `withdrawal_requests`
--
ALTER TABLE `withdrawal_requests`
  ADD CONSTRAINT `fk_withdrawal_requests_association` FOREIGN KEY (`association_id`) REFERENCES `associations` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_withdrawal_requests_driver` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `withdrawal_requests_ibfk_1` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
