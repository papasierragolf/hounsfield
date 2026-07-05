import Foundation
import Capacitor
import MLX
import MLXLMCommon
import MLXVLM
import MLXHuggingFace
import HuggingFace
import Tokenizers

/// Native MLX inference for MedGemma on Apple Silicon.
///
/// Runs `mlx-community/medgemma-*` models directly — the MLX community
/// publishes ready-to-run quantized builds of the official Google weights,
/// so there is NO conversion step. The model is downloaded once from the
/// Hugging Face Hub into the app's Documents directory and used fully
/// offline afterwards.
@objc(MedGemmaMLXPlugin)
public class MedGemmaMLXPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MedGemmaMLXPlugin"
    public let jsName = "MedGemmaMLX"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private var container: ModelContainer?
    private var loadedModelId: String?
    private var loading = false
    private var generating = false
    private var genTask: Task<Void, Never>?

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    /// If weights for this model ship inside the app bundle
    /// (App/BundledModels/<repo-name>/), return that directory.
    private func bundledModelURL(for modelId: String) -> URL? {
        let name = modelId.split(separator: "/").last.map(String.init) ?? modelId
        guard let dir = Bundle.main.resourceURL?
            .appendingPathComponent("BundledModels")
            .appendingPathComponent(name)
        else { return nil }
        let config = dir.appendingPathComponent("config.json")
        return FileManager.default.fileExists(atPath: config.path) ? dir : nil
    }

    @objc func load(_ call: CAPPluginCall) {
        let modelId = call.getString("modelId") ?? "mlx-community/medgemma-1.5-4b-it-4bit"
        if loadedModelId == modelId, container != nil {
            call.resolve(["modelId": modelId, "device": "mlx"])
            return
        }
        guard !loading else {
            call.reject("A model load is already in progress.")
            return
        }
        loading = true
        // Cap the Metal buffer cache so a 4B model fits alongside the WebView.
        MLX.Memory.cacheLimit = 64 * 1024 * 1024

        Task {
            do {
                // Prefer weights shipped inside the app: instant, zero network.
                let configuration: ModelConfiguration
                if let bundled = bundledModelURL(for: modelId) {
                    configuration = ModelConfiguration(directory: bundled)
                    notifyListeners("mlxProgress", data: ["fraction": 1.0, "totalBytes": 1])
                } else {
                    configuration = ModelConfiguration(id: modelId)
                }
                let container = try await loadModelContainer(
                    from: HubDownloaderBridge(),
                    using: TransformersTokenizerLoader(),
                    configuration: configuration,
                    progressHandler: { [weak self] (progress: Progress) in
                        // completedUnitCount only advances at file boundaries (the
                        // model is one huge file); fractionCompleted is smooth.
                        self?.notifyListeners("mlxProgress", data: [
                            "fraction": progress.fractionCompleted,
                            "totalBytes": progress.totalUnitCount,
                        ])
                    }
                )
                self.container = container
                self.loadedModelId = modelId
                self.loading = false
                call.resolve(["modelId": modelId, "device": "mlx"])
            } catch {
                self.loading = false
                self.container = nil
                self.loadedModelId = nil
                call.reject("Model load failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func unload(_ call: CAPPluginCall) {
        guard !generating else {
            call.reject("Cannot unload while a generation is in progress.")
            return
        }
        container = nil
        loadedModelId = nil
        // Flush the Metal GPU buffer cache so the memory is actually returned to the OS.
        MLX.Memory.cacheLimit = 0
        call.resolve(["unloaded": true])
    }

    @objc func generate(_ call: CAPPluginCall) {
        guard let container = self.container else {
            call.reject("Model not loaded yet.")
            return
        }
        guard !generating else {
            call.reject("A generation is already in progress.")
            return
        }
        let requestId = call.getString("requestId") ?? UUID().uuidString
        let systemPrompt = call.getString("systemPrompt") ?? ""
        let userPrompt = call.getString("userPrompt") ?? ""
        let maxTokens = call.getInt("maxNewTokens") ?? 1024
        let imagesB64: [String] = (call.getArray("images") as? [String]) ?? []

        generating = true
        genTask = Task {
            defer { self.generating = false; self.genTask = nil }
            do {
                // Decode base64 JPEGs to temp files; UserInput.Image loads from URL.
                var images: [UserInput.Image] = []
                var tempURLs: [URL] = []
                for b64 in imagesB64 {
                    // Strip the "data:image/…;base64," header if present (everything
                    // after the first comma is the payload).
                    let clean: String
                    if let comma = b64.firstIndex(of: ",") {
                        clean = String(b64[b64.index(after: comma)...])
                    } else {
                        clean = b64
                    }
                    // .ignoreUnknownCharacters tolerates stray newlines/whitespace so a
                    // valid image is never silently dropped (which would make the model
                    // run text-only and reply "I can't read this image").
                    guard let data = Data(base64Encoded: clean, options: .ignoreUnknownCharacters) else { continue }
                    let url = FileManager.default.temporaryDirectory
                        .appendingPathComponent("hounsfield-\(UUID().uuidString).jpg")
                    try data.write(to: url)
                    tempURLs.append(url)
                    images.append(.url(url))
                }
                defer { for url in tempURLs { try? FileManager.default.removeItem(at: url) } }

                // If images were sent but none decoded, fail loudly rather than
                // silently running a text-only prompt that produces a refusal.
                if !imagesB64.isEmpty && images.isEmpty {
                    call.reject("Could not decode the study image. Please re-capture or re-import it, then try again.")
                    return
                }

                let session = ChatSession(
                    container,
                    instructions: systemPrompt.isEmpty ? nil : systemPrompt,
                    // A small non-zero temperature keeps refusals from being sticky:
                    // at 0.0 a declined image would produce the identical refusal on
                    // every re-analyze. This lets re-analyze genuinely retry.
                    generateParameters: GenerateParameters(maxTokens: maxTokens, temperature: 0.3)
                )

                let started = Date()
                var full = ""
                var stopped = false
                for try await chunk in session.streamResponse(
                    to: userPrompt, images: images, videos: [], audios: []
                ) {
                    // Cooperative cancellation: stop() cancels this Task, so break
                    // out of the stream and resolve with the partial text instead
                    // of throwing.
                    if Task.isCancelled { stopped = true; break }
                    full += chunk
                    self.notifyListeners("mlxToken", data: ["requestId": requestId, "text": chunk])
                }
                call.resolve([
                    "requestId": requestId,
                    "text": full,
                    "elapsedMs": Int(Date().timeIntervalSince(started) * 1000),
                    "stopped": stopped,
                ])
            } catch is CancellationError {
                call.resolve([
                    "requestId": requestId,
                    "text": "",
                    "elapsedMs": 0,
                    "stopped": true,
                ])
            } catch {
                call.reject("Generation failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        genTask?.cancel()
        call.resolve(["stopped": true])
    }
}
