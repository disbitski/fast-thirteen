import SwiftUI

@main
struct FastThirteenWatchApp: App {
    @StateObject private var store = FastThirteenStore()

    var body: some Scene {
        WindowGroup {
            WatchTrackerView()
                .environmentObject(store)
                .task { await store.refreshFromCloud() }
        }
    }
}

private struct WatchTrackerView: View {
    @EnvironmentObject private var store: FastThirteenStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    if let session = store.activeSession {
                        TimelineView(.periodic(from: .now, by: 30)) { context in
                            Text(FastTimeFormatter.duration(session.elapsed(at: context.date)))
                                .font(.title2.monospacedDigit().weight(.bold))
                        }
                        Text("Fast in progress")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Button("End fast", role: .destructive) { store.endFast() }
                    } else {
                        Image(systemName: "moon.stars.fill")
                            .font(.title)
                            .foregroundStyle(.tint)
                        Text("\(store.targetHours, specifier: "%.1f")-hour goal")
                            .font(.headline)
                        Button("Start fast") { store.startFast() }
                    }

                    Text(store.state.message)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    NavigationLink("Settings") { WatchSettingsView() }
                }
                .padding(.horizontal)
            }
            .navigationTitle("Fast 13")
        }
    }
}

private struct WatchSettingsView: View {
    @EnvironmentObject private var store: FastThirteenStore
    @State private var syncKey = ""

    var body: some View {
        List {
            Section("Goal") {
                Stepper(
                    "\(store.targetHours, specifier: "%.1f") hours",
                    value: Binding(
                        get: { store.targetHours },
                        set: { store.updateTarget(hours: $0) }
                    ),
                    in: 1 ... 48,
                    step: 0.5
                )
            }

            Section("Data") {
                Picker("Source", selection: Binding(
                    get: { store.dataSource },
                    set: { source in Task { await store.selectDataSource(source) } }
                )) {
                    ForEach(TrackerDataSource.allCases) { source in
                        Text(source.title).tag(source)
                    }
                }
                if store.dataSource == .cloud {
                    SecureField("Sync key", text: $syncKey)
                    Button(store.hasCloudSyncKey ? "Replace key" : "Save key") {
                        Task { await store.saveCloudSyncKey(syncKey) }
                    }
                    Button("Refresh Cloudflare") { Task { await store.refreshFromCloud() } }
                }
            }

            Section("Apple Health") {
                Text("Apple Health has no fasting-session record type, so Fast Thirteen keeps this data private and accurate.")
                    .font(.footnote)
            }
        }
        .navigationTitle("Settings")
    }
}
