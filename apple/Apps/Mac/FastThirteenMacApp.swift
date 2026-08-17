import SwiftUI

@main
struct FastThirteenMacApp: App {
    @StateObject private var store = FastThirteenStore()
    @State private var showingAbout = false

    var body: some Scene {
        WindowGroup {
            FastThirteenRootView()
                .environmentObject(store)
                .frame(minWidth: 700, minHeight: 560)
                .task { await store.refreshFromCloud() }
                .sheet(isPresented: $showingAbout) {
                    NavigationStack {
                        FastThirteenAboutView()
                    }
                    .frame(width: 560, height: 430)
                }
        }
        .commands {
            CommandGroup(replacing: .appInfo) {
                Button("About Fast Thirteen") {
                    showingAbout = true
                }
            }
        }
    }
}
