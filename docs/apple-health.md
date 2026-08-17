# Apple Health And Fasting Data

Fast Thirteen can keep fasting history on the device or synchronize it with
private Cloudflare sync. That history is intentionally separate from
Apple Health for now.

Apple's current HealthKit data-type catalog does not include a fasting-session
record. Writing a fast as dietary energy, a meal, a workout, or mindfulness
time would make the Health record inaccurate, so Fast Thirteen does not request
HealthKit write access or create a misleading substitute sample.

The iPhone, Mac, and Apple Watch apps show this clearly in Settings. When Apple
adds a suitable fasting data type, the native client can add an explicit,
user-approved HealthKit sharing flow without changing the underlying Fast
Thirteen history.

For now, the native apps retain their own complete fasting history and share it
through the selected local or Cloudflare data source.
