# Connection Security Guide

## Overview

Harmony AI App offers flexible security options when connecting to Harmony Link, allowing you to choose the best connection method for your setup.

## Security Modes

When you connect to Harmony Link, the app may present you with security options. Understanding these modes will help you make the right choice for your situation.

### 🔒 Secure (Verified SSL)

**What it is**: The most secure connection type using encrypted communication with verified certificates.

**When to use**:
- Connecting over the internet
- When Harmony Link has a properly signed SSL certificate
- Production environments
- When maximum security is required

**Pros**:
- Highest level of security
- Industry standard encryption
- Protection against eavesdropping

**Cons**:
- Requires a valid SSL certificate (can be expensive)
- May not work with self-signed certificates on Android

---

### 🔓 Trust This Certificate (Self-Signed SSL)

**What it is**: Encrypted connection that trusts self-signed certificates created by Harmony Link.

**When to use**:
- Home networks with Harmony Link
- Development and testing
- When you see a certificate error and trust the server
- Private networks where you control both devices

**Pros**:
- Still provides encryption
- Works with Harmony Link's auto-generated certificates
- Free - no certificate purchase needed

**Cons**:
- Less secure than verified SSL
- You must manually trust the certificate
- Vulnerable if someone intercepts your network

**Security Note**: Only use this mode when connecting to your own Harmony Link server on a network you trust.

---

### ⚠️ Unencrypted Connection

**What it is**: Connection without any encryption (like regular HTTP vs HTTPS).

**When to use**:
- Last resort only
- Local development on same machine
- Troubleshooting connection issues

**Pros**:
- Always works
- No certificate configuration needed
- Easy to set up

**Cons**:
- **NO ENCRYPTION** - anyone on your network can see your data
- Not recommended for any real use
- Only suitable for testing

**⚠️ Warning**: Never use this mode over public WiFi or the internet. Your data will be visible to anyone monitoring the network.

---

## First-Time Connection

When you first connect to Harmony Link:

1. **Enter Connection Details**
   - IP address of your Harmony Link server
   - Port number (usually 8080)

2. **Approve on Harmony Link**
   - Go to your Harmony Link computer
   - Approve the pairing request

3. **Choose Security Mode** (if prompted)
   - If the connection works immediately, you're using Secure mode ✅
   - If you see a certificate error, you'll be asked to choose:
     - "Trust This Certificate" for encrypted self-signed connections
     - "Use Unencrypted Connection" as last resort

4. **Connection Established**
   - Your choice is remembered for this device
   - You won't be prompted again unless you reset it

## Certificate Verification Failed - What Does It Mean?

If you see this message, it means:

- Harmony Link is using a self-signed certificate (common for home use)
- Your Android device doesn't automatically trust it
- You need to choose how to proceed

**This is normal** for personal Harmony Link installations!

## Viewing Certificate Details

When the security prompt appears, you can tap "View Certificate Details" to see:

- Who issued the certificate (usually "Harmony Link")
- Certificate fingerprint
- Validity period

This helps you verify you're connecting to the right server.

## Managing Your Security Settings

### Viewing Current Mode

1. Open **Settings** → **Data Synchronization**
2. Look for "Security Mode" in the Sync Status card
3. You'll see one of:
   - 🔒 Secure (Verified SSL)
   - 🔓 Trusted Certificate (Self-Signed)
   - ⚠️ Unencrypted (No SSL)

### Resetting Security Mode

If you want to change your security settings:

1. Go to **Settings** → **Data Synchronization**
2. Tap **Reset Security Mode**
3. Confirm the reset
4. Disconnect and reconnect
5. You'll be prompted to choose again

## Recommended Settings

### For Home Use

✅ **Recommended**: Trust This Certificate (Self-Signed SSL)
- Provides encryption
- Works with Harmony Link's built-in certificates
- Good balance of security and convenience

### For Public/Cloud Deployment

✅ **Recommended**: Secure (Verified SSL)
- Get a proper SSL certificate (e.g., from Let's Encrypt)
- Maximum security for internet connections
- Required for public-facing servers

### For Local Testing

⚠️ **Acceptable**: Unencrypted
- Only when Harmony Link is on the same computer
- Never over a network
- Temporary use only

## Troubleshooting

### "Connection Failed - Certificate Error"

**Solution**: This is expected with self-signed certificates
1. Wait for the security prompt to appear
2. Select "Trust This Certificate"
3. Connection should succeed

### "Can't Connect Even with Unencrypted Mode"

**Possible causes**:
- Wrong IP address or port
- Harmony Link not running
- Firewall blocking connection
- Different network (phone not on WiFi)

**Solution**:
1. Verify Harmony Link is running
2. Check IP address is correct
3. Ensure both devices on same network
4. Check firewall settings

### "Want to Switch to Secure Mode Later"

**Solution**:
1. Get a proper SSL certificate for Harmony Link
2. In app: Settings → Sync → Reset Security Mode
3. Reconnect - should work with Secure mode now

## Security Best Practices

✅ **Do**:
- Use Secure mode when possible
- Use Trust This Certificate for home networks
- Keep your devices updated
- Use strong WiFi passwords

❌ **Don't**:
- Use Unencrypted mode over public WiFi
- Trust certificates from unknown servers
- Ignore security warnings without understanding them

## Privacy & Data Storage

Your security mode preference is stored locally on your device:
- Stored in: App's secure storage (AsyncStorage)
- Per device setting (doesn't sync to other devices)
- Can be cleared anytime via Reset button

No security credentials are shared with third parties.

## FAQ

**Q: Why am I seeing a certificate error?**  
A: Harmony Link generates its own certificates for convenience. They're not signed by a public authority, so devices need to be told to trust them.

**Q: Is "Trust This Certificate" safe?**  
A: Yes, if you're connecting to your own Harmony Link on a network you control. The connection is still encrypted.

**Q: How do I get rid of the warning?**  
A: Either:
1. Use "Trust This Certificate" mode (connection is still encrypted)
2. Get a proper SSL certificate for Harmony Link (more complex)

**Q: What if someone steals my certificate?**  
A: With a self-signed certificate, they'd need access to your network. Use strong WiFi security and trusted networks only.

**Q: Can I use different modes for different connections?**  
A: Currently, the setting is per device. To change modes, use the Reset button in Sync Settings.

## Need Help?

If you're still having issues:
1. Check the Harmony Link documentation
2. Visit our community forums
3. Report issues on GitHub

---

**Remember**: The goal is secure communication between your devices. Choose the option that provides the best security for your specific situation.
