import type { TcSectionData } from "../components/registration/TermsGate";

// Terms & Conditions / Privacy Policy content shown at registration for
// each of the three self-registering roles (Commuter/Operator/Association),
// via the shared TermsGate component. Written to reflect TranSync's real,
// already-implemented rules — same approach PassengerForm.tsx's existing
// booking-time Terms & Conditions/Cancellation Policy already takes,
// not generic placeholder legal text.
//
// TERMS_VERSION/PRIVACY_VERSION must be kept in lockstep with
// CURRENT_TERMS_VERSION/CURRENT_PRIVACY_VERSION in
// transync-backend/config/policy.php — bump both sides together to require
// re-acceptance of an updated policy.
export const TERMS_VERSION = "1.0";
export const PRIVACY_VERSION = "1.0";

export const PRIVACY_POLICY: TcSectionData[] = [
  {
    title: "What We Collect",
    body: "Your name, date of birth, email, phone number, and — if you apply for a Student, PWD, or Senior Citizen discount — the ID photos and live selfie captures used to verify your identity and eligibility. Operators and associations additionally provide business/organization details and supporting documents required for account and membership review.",
  },
  {
    title: "How We Use It",
    body: "To create and secure your account, process your bookings and payments, verify discount eligibility (OCR text matching, face comparison, and liveness checks against the ID and selfies you submit), and review operator/association applications. We never use this information for anything beyond operating TranSync.",
  },
  {
    title: "Who Can See It",
    body: "Admin reviewers see submitted documents only when a verification needs manual review. A driver checking your fare at boarding sees only your discount status, never your uploaded ID or selfie photos. Operators and associations reviewing each other's applications see only the documents relevant to that specific review.",
  },
  {
    title: "Document Storage",
    body: "Uploaded ID photos, selfies, and business/association documents are stored securely and used only for the verification they were submitted for. They are never sold, shared with third parties, or used for any purpose beyond identity/eligibility verification and account/application review.",
  },
  {
    title: "Your Rights",
    body: "You can request details about the information TranSync holds about your account, or request account deletion, by contacting support. Deleting an account removes its associated records according to system policy.",
  },
  {
    title: "Policy Updates",
    body: "If this Privacy Policy or the applicable Terms & Conditions are updated, you may be asked to review and accept the new version before continuing to use TranSync. Your original acceptance record is preserved regardless.",
  },
];

// Reused by Settings → Terms & Policies (Core Flow 2b) as a read-only
// viewer — copied verbatim from PassengerForm.tsx's own booking-time
// Cancellation Policy sheet (that file keeps its own separate inline copy,
// untouched) so Settings shows the exact same copy without a second source
// of truth drifting from it. Rewritten 2026-08-12 — simplified to a
// two-tier refund (100%/50%, no 0% floor) with no post-booking grace
// period, and an expanded no-show/rebooking section reflecting the 1-day
// rebook window and the operator-approved rebooking flow.
export const CANCELLATION_POLICY: TcSectionData[] = [
  {
    title: "Bus Refund Schedule",
    body: "Cancelling 3 days (72 hours) or more before departure refunds 100%. Cancelling less than 3 days before departure refunds 50%, no matter how close to departure — there is no point at which a cancellation is refused a refund entirely.",
  },
  {
    title: "UV Express Refund Schedule",
    body: "Cancelling 1 day (24 hours) or more before your booked time refunds 100%. Cancelling less than 1 day before refunds 50%, no matter how close to your booked time.",
  },
  {
    title: "Where the Other Half Goes",
    body: "On a 50% cancellation, the half that isn't refunded is paid out to the driver/operator/system, the same as if the trip had happened — the seat couldn't be resold that close to departure.",
  },
  {
    title: "If the Operator Cancels Your Trip",
    body: "If your operator cancels a scheduled trip, you always receive a 100% refund, no matter how close to departure the cancellation happens — you're never penalized for a cancellation that wasn't your choice.",
  },
  {
    title: "Where Your Refund Goes",
    body: "Any refund — full or partial — is credited straight back to your TranSync wallet balance, never to an external payment method.",
  },
  {
    title: "If You Miss Your Trip (No-Show)",
    body: "An unboarded ticket past its boarding window becomes a no-show — the full fare is paid out to the driver/operator/system, and no refund is issued. You then have 24 hours to request a rebook on that booking.",
  },
  {
    title: "Rebooking a Missed Trip",
    body: "A rebook request must be approved by your operator before you can act on it. Once approved, you pick a new departure of the same vehicle type from the same operator and pay a fee equal to 10% of your original fare — not a second full fare. If you don't request a rebook within 24 hours, or the operator doesn't approve it, the original fare stays settled to the driver/operator/system and the booking is closed.",
  },
  {
    title: "Booking Again After Cancelling",
    body: "Cancelling doesn't hold your seat — if you still want to travel, you'll need to make a new booking at the standard fare. The 10% rebooking fee only applies to an approved rebook on a missed booking; it never applies to a fresh booking after your own cancellation.",
  },
  {
    title: "When You Can No Longer Cancel",
    body: "Once your QR ticket has been scanned at boarding, or your trip has departed and its boarding window has passed, the booking can no longer be cancelled — it becomes a no-show instead, per the rule above.",
  },
  {
    title: "Policy Basis",
    body: "This summary reflects TranSync's current cancellation and refund policy as implemented in the app. Contact your operator or association for any trip-specific exceptions.",
  },
];

export const COMMUTER_TERMS: TcSectionData[] = [
  {
    title: "Accurate Account Information",
    body: "You must provide your true legal name, date of birth, and contact information. This information is used to verify your identity if you apply for a Student, PWD, or Senior Citizen discount — inaccurate information can cause your verification to fail or be rejected.",
  },
  {
    title: "Account Security",
    body: "You are responsible for keeping your password confidential and for all activity on your account. Choose a password of at least 6 characters and never share your login credentials with anyone else.",
  },
  {
    title: "Booking Rules",
    body: "Bus and UV Express bookings require at least 24 hours' notice before departure. A Bus booking requires selecting a specific seat; UV Express bookings are headcount-only. Each booking's boarding QR code is personal to you and must not be shared.",
  },
  {
    title: "Payment & Fare Rules",
    body: "All bookings are paid from your TranSync wallet balance, funded through GCash (Demo) top-ups. A booking's fare is held (escrowed) the moment it's confirmed and released to the driver/operator/system only once your trip is resolved — by boarding, refund, or forfeiture.",
  },
  {
    title: "Cancellation & Refund Policy",
    body: "Refunds are tiered by how early you cancel — 100% at 3+ days for Bus (1+ day for UV Express), 50% for anything closer, no matter how close. Whatever isn't refunded is paid out as if the trip had happened. If your operator cancels the trip, you always get a 100% refund. Missing your trip is a no-show, not a refund — you then have 24 hours to request an operator-approved rebook for a 10% fee. See our full Cancellation Policy for the exact schedule.",
  },
  {
    title: "Rebooking Policy",
    body: "If you miss a booking (no-show), you may request a rebook from the operator's manifest screen. An operator-initiated rebook only charges a 10% surcharge on the original fare — not a full new fare — since the original fare's value was already distributed at the time it was forfeited. Rebooking is never automatic and is always initiated by the operator confirming it.",
  },
  {
    title: "Discount Verification Requirements",
    body: "Selecting Student, PWD, or Senior Citizen during registration only records that you intend to apply for that discount — it does not activate it. Your discount becomes active only after you complete the corresponding verification (ID capture, live selfie/liveness check, and either automatic approval or admin review). Until verification succeeds, your fare is charged at the standard rate.",
  },
  {
    title: "Prohibition of Fraudulent Accounts",
    body: "Each account must belong to one real person using their own identity. Creating an account under a false identity, or maintaining multiple accounts to abuse promotions or discounts, is prohibited and may result in suspension.",
  },
  {
    title: "Prohibition of Fraudulent or Altered Documents",
    body: "Submitting a fake, altered, borrowed, or otherwise not-genuinely-yours ID or supporting document during discount verification is strictly prohibited. Verification photos that don't match your own face with high confidence are automatically and permanently rejected — no account is created from that submission.",
  },
  {
    title: "Physical ID Requirements",
    body: "Even with a system-verified discount, a driver may ask to see your physical ID at boarding. If you can't produce it when asked, the driver may adjust your fare to the standard rate for that trip; conversely, showing a valid physical ID at boarding can grant a discount even if your account isn't yet system-verified.",
  },
  {
    title: "Account Suspension or Termination",
    body: "TranSync may suspend or terminate an account that violates these terms — including fraudulent discount claims, fraudulent or altered documents, or repeated abuse of the booking/cancellation/rebooking system — according to system policy.",
  },
];

export const OPERATOR_TERMS: TcSectionData[] = [
  {
    title: "Operator Responsibilities",
    body: "You are responsible for the accuracy of your registration information, the documents you submit, and for maintaining your fleet, drivers, and trips in good standing. Registering an account does not by itself authorize you to operate — see Association Requirements below.",
  },
  {
    title: "Association Requirements",
    body: "To run vehicles of a given type (Jeepney, UV Express, or Bus), you must separately apply to and be approved by an association for that specific vehicle type. Your account can exist while an association application remains pending, and you may hold approved memberships at multiple associations for different vehicle types at once.",
  },
  {
    title: "Vehicle Requirements",
    body: "Every vehicle you register must meet the seating/capacity rules for its type and, for Bus vehicles, have a class assigned and a saved seat layout before it can be scheduled for trips. You are responsible for keeping vehicle information accurate and up to date.",
  },
  {
    title: "Driver Management Responsibilities",
    body: "Driver accounts are created and managed by you directly — you are responsible for the credentials you issue to your drivers and for keeping their assigned vehicles and routes accurate.",
  },
  {
    title: "Schedule & Trip Responsibilities",
    body: "For Bus, you are responsible for assigning a vehicle, driver, and (optionally) conductor to system-generated trips, and for progressing each trip's status (boarding, departure, completion) accurately. For UV Express, you are responsible for activating or deactivating your fleet's participation in your association's published schedule.",
  },
  {
    title: "Fare Policies",
    body: "Bus and UV Express fares and classes are set by your association, not by you — your role is limited to assigning a class to a vehicle and building that vehicle's seat layout. Jeepney fares remain traditional/cash and are not managed through the app.",
  },
  {
    title: "Remittance & Quota Policies",
    body: "For Bus/UV Express, the system automatically deducts a flat percentage of each fare, and you choose whether your own cut is a flat percentage (auto-deducted the same way) or settled manually with drivers via the quota system. Jeepney drivers separately pay a recurring platform quota directly to the system, unrelated to your own operator-driver quota arrangement.",
  },
  {
    title: "Wallet & Payment Rules",
    body: "Your operator wallet balance reflects your share of completed bookings and confirmed quota submissions. Withdrawal requests debit your balance immediately and are fulfilled manually — submitting a request does not guarantee an immediate payout.",
  },
  {
    title: "Booking Responsibilities",
    body: "You are responsible for honoring confirmed bookings on your trips and slots, including operator-initiated cancellations (which refund affected passengers in full) and operator-initiated rebooking of no-show passengers.",
  },
  {
    title: "Document Authenticity",
    body: "All documents you submit — at registration and for any association application — must be genuine and currently valid. Submitting a fraudulent, altered, or borrowed document is a serious violation of these terms.",
  },
  {
    title: "Prohibition of Fraudulent Information",
    body: "Providing false personal, business, or vehicle information anywhere in the app — at registration, in an association application, or in vehicle/driver records — is prohibited and may result in account suspension.",
  },
  {
    title: "Compliance with System & Association Policies",
    body: "You agree to comply with TranSync's system-wide policies and with the specific policies of any association you're approved under, including their document requirements and review decisions.",
  },
  {
    title: "Account Suspension or Revocation",
    body: "TranSync or an approving association may suspend or revoke your account or a specific association membership for violating these terms, submitting fraudulent documents, or other conduct inconsistent with system policy.",
  },
];

export const ASSOCIATION_TERMS: TcSectionData[] = [
  {
    title: "Association Responsibilities",
    body: "You are responsible for the accuracy of your registration information, your authorized representative's details, and the documents you submit. Your account remains pending admin verification after registration — it is not automatically approved.",
  },
  {
    title: "Operator Approval Responsibilities",
    body: "You are responsible for reviewing and deciding on operator applications for each vehicle type, including verifying their submitted LTO/LTFRB documents. Approval must not be granted to an operator whose account the admin has not yet verified.",
  },
  {
    title: "Driver & Vehicle Management",
    body: "While drivers and vehicles are registered by their own operators, you are responsible for the visibility and route access you grant to operator fleets approved under your association, and for removing a member operator's access when appropriate.",
  },
  {
    title: "Route & Schedule Management",
    body: "Routes for every vehicle type (Jeepney, UV Express, Bus) are created and owned by your association, not by individual operators. You are responsible for keeping published routes, recurring schedules, and operating hours accurate and up to date.",
  },
  {
    title: "Fare Management",
    body: "You are responsible for defining and maintaining the Bus class catalog and per-class, per-route fares, and the flat fares for Jeepney/UV Express routes you publish. Operators may only assign an existing class to a vehicle — they cannot set fares themselves.",
  },
  {
    title: "Association Member Management",
    body: "You are responsible for keeping your member operators' vehicle-type approvals current, including reviewing new applications and removing memberships when a member operator is no longer in good standing.",
  },
  {
    title: "Document Verification",
    body: "You must review the documents an operator submits with their application (and their registration-time document) before approving any vehicle-type membership, and only approve applications that meet your association's and the system's requirements.",
  },
  {
    title: "Remittance & System Fees",
    body: "The system automatically retains a flat percentage of every Bus/UV Express booking fare, separate from and in addition to any cut your member operators choose to take. This fee structure is set at the system level and is not configurable by your association.",
  },
  {
    title: "Fraud Prevention",
    body: "You must not knowingly approve an operator application supported by fraudulent, altered, or borrowed documents, and must report suspected fraud according to system policy.",
  },
  {
    title: "Account Security",
    body: "You are responsible for keeping your authorized representative's login credentials confidential and for all activity performed under your association's account.",
  },
  {
    title: "Compliance with System Policies",
    body: "You agree to operate within TranSync's system-wide policies for route publishing, fare management, member review, and remittance, and to keep your association's information accurate as these policies evolve.",
  },
  {
    title: "Suspension or Revocation",
    body: "TranSync may suspend or revoke your association's account for violating these terms, approving fraudulent operator applications, or other conduct inconsistent with system policy.",
  },
];

// Reused by Driver Settings → Terms & Policies. Driver accounts are created
// by an operator, not self-registered, so this content isn't shown at
// registration time the way the other three roles' terms are — it's only
// ever reached from Settings.
export const DRIVER_TERMS: TcSectionData[] = [
  {
    title: "Driver Responsibilities",
    body: "You are responsible for operating your assigned vehicle safely and in accordance with your operator's and association's instructions, and for keeping the personal information on your account accurate.",
  },
  {
    title: "Account Security",
    body: "Your driver account is created and its initial credentials are set by your operator. You are responsible for keeping your password confidential and for all activity performed under your account, including changing your password if you believe it's been compromised.",
  },
  {
    title: "Vehicle Assignment",
    body: "Your assigned vehicle and vehicle type are set by your operator and cannot be changed from your own account. If your assignment changes, your Profile reflects the new assignment automatically once your operator updates it.",
  },
  {
    title: "QR Boarding Conduct",
    body: "For Bus and UV Express, you are responsible for accurately scanning each passenger's boarding QR code and for using Discount Mode honestly — only granting or declining a fare discount based on whether the passenger actually presents a valid physical Student, PWD, or Senior Citizen ID, per TranSync's discount verification rules.",
  },
  {
    title: "Fare & Discount Handling",
    body: "You cannot manually set or override a passenger's fare amount outside of what the system computes and the discount-override rules allow. Jeepney fares remain traditional/cash and are not processed through the app.",
  },
  {
    title: "Wallet, Quota & Remittance Obligations",
    body: "Your earnings are credited to your in-app wallet according to your operator's remittance arrangement. If you're a Jeepney driver, you're responsible for keeping your platform quota payments current — an overdue quota suspends your ability to join the dispatch queue until paid.",
  },
  {
    title: "Trip & Route Conduct",
    body: "For Bus, you are responsible for accurately progressing your assigned trip's status (boarding, departure, completion) as it actually happens. For all vehicle types, you should only operate your assigned route.",
  },
  {
    title: "Association & Operator Relationship",
    body: "Your association membership is transitive through your operator's own approved vehicle-type membership — you don't apply to an association directly. If your operator's membership for your vehicle's type changes, this can affect your own association context.",
  },
  {
    title: "Prohibition of Fraudulent Discount Grants",
    body: "Knowingly granting a discount to a passenger who hasn't presented a valid physical ID, or declining one improperly, is a violation of these terms and may result in account suspension.",
  },
  {
    title: "Document & License Accuracy",
    body: "The license number and personal information on your account must be accurate and kept up to date.",
  },
  {
    title: "Compliance with System Policies",
    body: "You agree to operate within TranSync's system-wide policies for boarding, fare handling, and remittance, and within your operator's and association's own operating rules.",
  },
  {
    title: "Account Suspension",
    body: "Your operator or TranSync may suspend your account for violating these terms, including fraudulent discount handling or other conduct inconsistent with system policy.",
  },
];
