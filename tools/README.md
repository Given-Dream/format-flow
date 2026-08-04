# Format Flow License Manager

This owner-only tool creates a permanent password bound to one Format Flow machine code.

## Usage

The graphical manager is the recommended tool:

```powershell
npm run license-manager-app
```

To build its standalone Windows installer:

```powershell
npm run dist-license-manager
```

The manager window accepts a machine code, generates a password, and copies the result for delivery to the user.

The command-line version remains available for scripted use:

```powershell
npm run license-manager -- FF-12345678-90ABCDEF-12345678-90ABCDEF
```

The manager reads the owner-only private signing key from:

```text
%USERPROFILE%\.format-flow-license\private-key.pem
```

Keep that file private and back it up. It is not included in the application installer or GitHub repository. If it is lost, do not generate a replacement: a new key would not match the public key already compiled into released clients. The installed application contains only the matching public key and can verify passwords, but cannot generate them.

Users copy the machine code shown on the authorization screen and send it to the owner. The owner runs this manager and sends back the generated permanent password. The user enters it once; the activation is stored locally in `license.json` and is checked against the same machine code on later launches.

## Open-source references

- [Keygen](https://github.com/keygen-sh/keygen) is an open-source licensing and distribution API with server-side entitlement management.
- [Keygen documentation](https://keygen.sh/docs/) describes signed license tokens, machine fingerprints, and revocation-oriented designs.

Format Flow uses the simpler offline variant: Ed25519 signatures, no license server, permanent machine binding, and no private key in the client. This is suitable for controlled distribution, but no client-only offline license can prevent a determined user from patching the application binary.
