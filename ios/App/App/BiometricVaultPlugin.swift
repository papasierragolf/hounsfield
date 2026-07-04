import Foundation
import Capacitor
import LocalAuthentication
import Security

/// Manages a 256-bit symmetric key locked behind Face ID / Touch ID.
///
/// The key itself never touches JS in plaintext storage — it lives only in
/// the iOS Keychain, protected by a `SecAccessControl` with `.biometryCurrentSet`.
/// That flag means the OS itself refuses to release the key unless the
/// current biometric enrollment succeeds (and it auto-invalidates if the
/// user adds/removes a fingerprint or face, forcing re-setup — a deliberate
/// security property, not a bug).
///
/// JS uses the returned raw key bytes to derive a WebCrypto AES-GCM key
/// (via `crypto.subtle.importKey`) that encrypts/decrypts studies and
/// images before they touch IndexedDB. This plugin only ever hands out the
/// key after a successful biometric prompt — it never stores or sees any
/// application data itself.
@objc(BiometricVaultPlugin)
public class BiometricVaultPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BiometricVaultPlugin"
    public let jsName = "BiometricVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setupKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteKey", returnType: CAPPluginReturnPromise),
    ]

    private let service = "com.hounsfield.vault"
    private let account = "hounsfield-vault-key"

    @objc func isAvailable(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        let canEvaluate = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        var kind = "none"
        if canEvaluate {
            switch context.biometryType {
            case .faceID: kind = "faceID"
            case .touchID: kind = "touchID"
            default: kind = "none"
            }
        }
        call.resolve(["available": canEvaluate, "biometryType": kind])
    }

    @objc func hasKey(_ call: CAPPluginCall) {
        call.resolve(["hasKey": keyExists()])
    }

    private func keyExists() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: false,
        ]
        return SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess
    }

    /// Generates fresh key material and stores it in the Keychain behind
    /// biometry. Creating the item does NOT itself prompt Face ID — only
    /// reading it back via `unlock()` does, since the access control is
    /// evaluated at read time.
    @objc func setupKey(_ call: CAPPluginCall) {
        if keyExists() {
            call.resolve(["created": false])
            return
        }
        var keyBytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, keyBytes.count, &keyBytes) == errSecSuccess else {
            call.reject("Could not generate secure key material.")
            return
        }
        var accessError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            .biometryCurrentSet,
            &accessError
        ) else {
            call.reject("Could not create biometric access control.")
            return
        }
        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(keyBytes),
            kSecAttrAccessControl as String: access,
        ]
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        guard status == errSecSuccess else {
            call.reject("Could not store key in Keychain (status \(status)).")
            return
        }
        call.resolve(["created": true])
    }

    /// Prompts Face ID / Touch ID (via the Keychain's own access-control
    /// check) and, on success, returns the raw key bytes as base64.
    @objc func unlock(_ call: CAPPluginCall) {
        let context = LAContext()
        context.localizedReason = "Unlock Hounsfield"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecUseAuthenticationContext as String: context,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            switch status {
            case errSecUserCanceled:
                call.reject("cancelled")
            case errSecItemNotFound:
                call.reject("No vault key found. Enable biometric lock in Settings first.")
            case errSecAuthFailed:
                call.reject("Biometric authentication failed.")
            default:
                call.reject("Could not unlock the vault (status \(status)).")
            }
            return
        }
        call.resolve(["key": data.base64EncodedString()])
    }

    /// Removes the Keychain item. Called when the user disables biometric
    /// lock (after the data has already been re-encrypted back to plaintext
    /// by the JS side) or wants to reset the vault.
    @objc func deleteKey(_ call: CAPPluginCall) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        call.resolve(["deleted": true])
    }
}
