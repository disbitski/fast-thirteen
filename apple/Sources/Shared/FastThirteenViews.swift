import SwiftUI

struct FastThirteenRootView: View {
    var body: some View {
        TabView {
            TrackerView()
                .tabItem { Label("Tracker", systemImage: "timer") }
            FastHistoryView()
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
            FastSettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}

struct TrackerView: View {
    @EnvironmentObject private var store: FastThirteenStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    Text("FAST THIRTEEN")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.tint)

                    if let session = store.activeSession {
                        TimelineView(.periodic(from: .now, by: 30)) { context in
                            ActiveFastCard(session: session, now: context.date)
                        }
                        Button("End fast", role: .destructive) { store.endFast() }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.large)
                    } else {
                        VStack(spacing: 10) {
                            Image(systemName: "moon.stars.fill")
                                .font(.system(size: 42))
                                .foregroundStyle(.tint)
                            Text("Ready when you are.")
                                .font(.title2.weight(.bold))
                            Text("Your next fast is set for \(store.targetHours, specifier: "%.1f") hours.")
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 48)
                        Button("Start fast") { store.startFast() }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.large)
                    }

                    Text(store.state.message)
                        .font(.footnote)
                        .foregroundStyle(store.state == .loading ? .secondary : .tertiary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: 560)
                .padding()
            }
            .navigationTitle("Tracker")
        }
    }
}

private struct ActiveFastCard: View {
    let session: FastingSession
    let now: Date

    var body: some View {
        let elapsed = session.elapsed(at: now)
        let target = session.targetHours * 3_600
        VStack(spacing: 12) {
            Text("FAST IN PROGRESS")
                .font(.caption.weight(.bold))
                .foregroundStyle(.tint)
            Text(FastTimeFormatter.duration(elapsed))
                .font(.system(size: 46, weight: .bold, design: .rounded).monospacedDigit())
            ProgressView(value: min(elapsed / target, 1))
                .tint(elapsed >= target ? .green : .accentColor)
            Text("\(session.targetHours, specifier: "%.1f")-hour goal · ends \(session.startedAt.addingTimeInterval(target), format: .dateTime.hour().minute())")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(28)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 24))
    }
}

struct FastHistoryView: View {
    @EnvironmentObject private var store: FastThirteenStore

    var body: some View {
        NavigationStack {
            List {
                if store.completedSessions.isEmpty {
                    ContentUnavailableView("No completed fasts", systemImage: "clock", description: Text("Finish your first fast and it will appear here."))
                } else {
                    ForEach(store.completedSessions) { session in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(session.startedAt, format: .dateTime.month().day().year())
                                .font(.headline)
                            Text("\(FastTimeFormatter.duration(session.elapsed())) · \(session.targetHours, specifier: "%.1f")-hour goal")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("History")
        }
    }
}

struct FastSettingsView: View {
    @EnvironmentObject private var store: FastThirteenStore
    @State private var syncKey = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Fasting target") {
                    Stepper(
                        "\(store.targetHours, specifier: "%.1f") hours",
                        value: Binding(
                            get: { store.targetHours },
                            set: { store.updateTarget(hours: $0) }
                        ),
                        in: 1 ... 48,
                        step: 0.5
                    )
                    Text("This goal is captured when you start a new fast.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Data location") {
                    Picker("Fasting data", selection: Binding(
                        get: { store.dataSource },
                        set: { source in Task { await store.selectDataSource(source) } }
                    )) {
                        ForEach(TrackerDataSource.allCases) { source in
                            Text(source.title).tag(source)
                        }
                    }
                    .pickerStyle(.menu)

                    Text(store.dataSource.detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    if store.dataSource == .cloud {
                        LabeledContent("Cloud API", value: FastThirteenCloud.origin.host() ?? "Cloudflare")
                        SecureField("Private sync key", text: $syncKey)
                            .textContentType(.password)
                        Button(store.hasCloudSyncKey ? "Replace sync key" : "Save sync key") {
                            Task { await store.saveCloudSyncKey(syncKey) }
                        }
                        Button("Refresh from Cloudflare") {
                            Task { await store.refreshFromCloud() }
                        }
                    }
                }

                Section("Apple Health") {
                    Label("Fasting stays in Fast Thirteen", systemImage: "heart.text.square")
                    Text("Apple Health does not currently offer a fasting-session record type. This app will not write your fasts as unrelated nutrition, workout, or mindfulness data.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
    }
}

enum FastTimeFormatter {
    static func duration(_ interval: TimeInterval) -> String {
        let totalSeconds = max(0, Int(interval.rounded(.down)))
        return String(format: "%02d:%02d", totalSeconds / 3_600, (totalSeconds % 3_600) / 60)
    }
}
