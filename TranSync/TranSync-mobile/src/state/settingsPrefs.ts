import AsyncStorage from "@react-native-async-storage/async-storage";

// Local-only preferences (no backend — this app has no push/notification
// infra, see CLAUDE.md) controlling which categories of Recent Activity
// entries render on Home, plus whether a verification-status change shows
// its own dismissible banner there. Each defaults to shown; only an
// explicit "false" hides it.

const KEYS = {
  bookingConfirmed:     "pref_notify_booking_confirmed",
  boardingTrip:         "pref_notify_boarding_trip",
  cancelRefund:         "pref_notify_cancel_refund",
  verificationStatus:   "pref_notify_verification_status",

  // Association Settings → Notifications. Inert for now (deliberate — see
  // CLAUDE.md's Association Settings note): unlike the commuter keys above,
  // which filter a real Recent Activity feed, this app has no activity-log
  // surface anywhere for driver/vehicle/route/fare/schedule changes, so
  // these currently persist a preference without gating anything yet.
  assocOperatorSubmission:  "pref_assoc_notify_operator_submission",
  assocOperatorReview:      "pref_assoc_notify_operator_review",
  assocDriverUpdates:       "pref_assoc_notify_driver_updates",
  assocVehicleUpdates:      "pref_assoc_notify_vehicle_updates",
  assocRouteUpdates:        "pref_assoc_notify_route_updates",
  assocScheduleUpdates:     "pref_assoc_notify_schedule_updates",
  assocFareUpdates:         "pref_assoc_notify_fare_updates",
  assocSystemAnnouncements: "pref_assoc_notify_system_announcements",

  // Operator Settings → Notifications. Same "inert for now" reasoning as
  // the association keys above — no activity-log surface exists for any of
  // these on the operator side either.
  opAssocApplication:       "pref_operator_notify_assoc_application",
  opAssocReview:            "pref_operator_notify_assoc_review",
  opVehicleUpdates:         "pref_operator_notify_vehicle_updates",
  opDriverUpdates:          "pref_operator_notify_driver_updates",
  opTripScheduleUpdates:    "pref_operator_notify_trip_schedule_updates",
  opSystemAnnouncements:    "pref_operator_notify_system_announcements",

  // Driver Settings → Notifications. Same "inert for now" reasoning as the
  // association/operator keys above.
  drvTripAssignment:        "pref_driver_notify_trip_assignment",
  drvScheduleChanges:       "pref_driver_notify_schedule_changes",
  drvVehicleAssignment:     "pref_driver_notify_vehicle_assignment",
  drvAssocAnnouncements:    "pref_driver_notify_assoc_announcements",
  drvQrBoarding:            "pref_driver_notify_qr_boarding",
  drvSystemAnnouncements:   "pref_driver_notify_system_announcements",
} as const;

async function getPref(key: string): Promise<boolean> {
  const v = await AsyncStorage.getItem(key);
  return v !== "false";
}
async function setPref(key: string, value: boolean): Promise<void> {
  await AsyncStorage.setItem(key, value ? "true" : "false");
}

export const getNotifyBookingConfirmed   = () => getPref(KEYS.bookingConfirmed);
export const setNotifyBookingConfirmed   = (v: boolean) => setPref(KEYS.bookingConfirmed, v);

export const getNotifyBoardingTrip       = () => getPref(KEYS.boardingTrip);
export const setNotifyBoardingTrip       = (v: boolean) => setPref(KEYS.boardingTrip, v);

export const getNotifyCancelRefund       = () => getPref(KEYS.cancelRefund);
export const setNotifyCancelRefund       = (v: boolean) => setPref(KEYS.cancelRefund, v);

export const getNotifyVerificationStatus = () => getPref(KEYS.verificationStatus);
export const setNotifyVerificationStatus = (v: boolean) => setPref(KEYS.verificationStatus, v);

export const getAssocNotifyOperatorSubmission  = () => getPref(KEYS.assocOperatorSubmission);
export const setAssocNotifyOperatorSubmission  = (v: boolean) => setPref(KEYS.assocOperatorSubmission, v);

export const getAssocNotifyOperatorReview      = () => getPref(KEYS.assocOperatorReview);
export const setAssocNotifyOperatorReview      = (v: boolean) => setPref(KEYS.assocOperatorReview, v);

export const getAssocNotifyDriverUpdates       = () => getPref(KEYS.assocDriverUpdates);
export const setAssocNotifyDriverUpdates       = (v: boolean) => setPref(KEYS.assocDriverUpdates, v);

export const getAssocNotifyVehicleUpdates      = () => getPref(KEYS.assocVehicleUpdates);
export const setAssocNotifyVehicleUpdates      = (v: boolean) => setPref(KEYS.assocVehicleUpdates, v);

export const getAssocNotifyRouteUpdates        = () => getPref(KEYS.assocRouteUpdates);
export const setAssocNotifyRouteUpdates        = (v: boolean) => setPref(KEYS.assocRouteUpdates, v);

export const getAssocNotifyScheduleUpdates     = () => getPref(KEYS.assocScheduleUpdates);
export const setAssocNotifyScheduleUpdates     = (v: boolean) => setPref(KEYS.assocScheduleUpdates, v);

export const getAssocNotifyFareUpdates         = () => getPref(KEYS.assocFareUpdates);
export const setAssocNotifyFareUpdates         = (v: boolean) => setPref(KEYS.assocFareUpdates, v);

export const getAssocNotifySystemAnnouncements = () => getPref(KEYS.assocSystemAnnouncements);
export const setAssocNotifySystemAnnouncements = (v: boolean) => setPref(KEYS.assocSystemAnnouncements, v);

export const getOpNotifyAssocApplication    = () => getPref(KEYS.opAssocApplication);
export const setOpNotifyAssocApplication    = (v: boolean) => setPref(KEYS.opAssocApplication, v);

export const getOpNotifyAssocReview         = () => getPref(KEYS.opAssocReview);
export const setOpNotifyAssocReview         = (v: boolean) => setPref(KEYS.opAssocReview, v);

export const getOpNotifyVehicleUpdates      = () => getPref(KEYS.opVehicleUpdates);
export const setOpNotifyVehicleUpdates      = (v: boolean) => setPref(KEYS.opVehicleUpdates, v);

export const getOpNotifyDriverUpdates       = () => getPref(KEYS.opDriverUpdates);
export const setOpNotifyDriverUpdates       = (v: boolean) => setPref(KEYS.opDriverUpdates, v);

export const getOpNotifyTripScheduleUpdates = () => getPref(KEYS.opTripScheduleUpdates);
export const setOpNotifyTripScheduleUpdates = (v: boolean) => setPref(KEYS.opTripScheduleUpdates, v);

export const getOpNotifySystemAnnouncements = () => getPref(KEYS.opSystemAnnouncements);
export const setOpNotifySystemAnnouncements = (v: boolean) => setPref(KEYS.opSystemAnnouncements, v);

export const getDrvNotifyTripAssignment      = () => getPref(KEYS.drvTripAssignment);
export const setDrvNotifyTripAssignment      = (v: boolean) => setPref(KEYS.drvTripAssignment, v);

export const getDrvNotifyScheduleChanges     = () => getPref(KEYS.drvScheduleChanges);
export const setDrvNotifyScheduleChanges     = (v: boolean) => setPref(KEYS.drvScheduleChanges, v);

export const getDrvNotifyVehicleAssignment   = () => getPref(KEYS.drvVehicleAssignment);
export const setDrvNotifyVehicleAssignment   = (v: boolean) => setPref(KEYS.drvVehicleAssignment, v);

export const getDrvNotifyAssocAnnouncements  = () => getPref(KEYS.drvAssocAnnouncements);
export const setDrvNotifyAssocAnnouncements  = (v: boolean) => setPref(KEYS.drvAssocAnnouncements, v);

export const getDrvNotifyQrBoarding          = () => getPref(KEYS.drvQrBoarding);
export const setDrvNotifyQrBoarding          = (v: boolean) => setPref(KEYS.drvQrBoarding, v);

export const getDrvNotifySystemAnnouncements = () => getPref(KEYS.drvSystemAnnouncements);
export const setDrvNotifySystemAnnouncements = (v: boolean) => setPref(KEYS.drvSystemAnnouncements, v);
