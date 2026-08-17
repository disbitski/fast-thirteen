import SwiftUI

@main
struct FastThirteenWatchApp: App {
    @StateObject private var store = FastThirteenStore()

    var body: some Scene {
        WindowGroup {
            WatchRootView()
                .environmentObject(store)
                .task { await store.refreshFromCloud() }
        }
    }
}

private struct WatchRootView: View {
    @EnvironmentObject private var store: FastThirteenStore

    var body: some View {
        TabView {
            WatchTrackerView()
                .tabItem { Label("Fast", systemImage: "timer") }
            WatchDashboardView()
                .tabItem { Label("Dashboard", systemImage: "chart.bar.fill") }
            WatchSettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .tabViewStyle(.verticalPage)
        .preferredColorScheme(store.theme.colorScheme)
        .tint(store.theme.tint)
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
                }
                .padding(.horizontal)
            }
            .navigationTitle("Fast 13")
        }
    }
}

private struct WatchDashboardView: View {
    @EnvironmentObject private var store: FastThirteenStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 8) {
                    WatchMetric(label: "Current streak", value: "\(store.insights.currentStreakDays) days", icon: "flame.fill")
                    WatchMetric(label: "Completed", value: "\(store.insights.completedCount)", icon: "checkmark.circle.fill")
                    WatchMetric(label: "Total fasting", value: String(format: "%.1f hr", store.insights.totalHours), icon: "sum")
                    WatchMetric(label: "Average fast", value: String(format: "%.1f hr", store.insights.averageHours), icon: "chart.line.uptrend.xyaxis")
                }
                .padding(.horizontal)
            }
            .navigationTitle("Dashboard")
        }
    }
}

private struct WatchMetric: View {
    let label: String
    let value: String
    let icon: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .foregroundStyle(.tint)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.headline.monospacedDigit())
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
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

            Section("Appearance") {
                Picker("Theme", selection: Binding(
                    get: { store.theme },
                    set: { store.selectTheme($0) }
                )) {
                    ForEach(FastThirteenTheme.allCases) { theme in
                        Text(theme.title).tag(theme)
                    }
                }
                Text(store.theme.detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
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

            Section("About") {
                NavigationLink {
                    FastThirteenAboutView()
                } label: {
                    Label("About Fast Thirteen", systemImage: "info.circle")
                }
            }
        }
        .navigationTitle("Settings")
    }
}
