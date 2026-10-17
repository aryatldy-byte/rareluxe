# Rare Luxe - Supabase Authentication Setup Guide

## Overview
Your Rare Luxe app has been successfully modified to use **Supabase Authentication** instead of hardcoded user credentials. This provides a secure, scalable authentication solution.

## ✨ Key Changes Made

### 1. **Removed Hardcoded Users**
   - ❌ Deleted the hardcoded `USERS` array with static credentials
   - ✅ Replaced with Supabase Auth

### 2. **Updated LoginScreen Component**
   - ✅ Added **Sign In** tab for existing users
   - ✅ Added **Sign Up** tab for new user registration
   - ✅ Email-based authentication instead of username
   - ✅ Real-time form validation
   - ✅ Better error handling with descriptive messages
   - ✅ Loading states for async operations

### 3. **Session Management**
   - ✅ Automatic session detection on app load
   - ✅ Real-time auth state listener
   - ✅ Persistent login across browser refreshes
   - ✅ Proper logout functionality that clears user session

### 4. **User Display Updates**
   - ✅ Shows email (username part) in header
   - ✅ Dynamic greeting based on authenticated user
   - ✅ Logout button properly calls Supabase signOut

## 🚀 Setup Instructions

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Update Supabase Credentials
The file `supabaseClient.js` contains your Supabase connection details. These are already pre-filled with your project's credentials:
- SUPABASE_URL: Your Supabase project URL
- SUPABASE_ANON_KEY: Your public API key

**No changes needed** if you want to use the existing Supabase project.

### Step 3: Enable Email Authentication in Supabase
1. Go to your Supabase Dashboard: https://app.supabase.com
2. Select your project
3. Go to **Authentication** → **Providers**
4. Ensure **Email** provider is enabled ✓

### Step 4: Test the Authentication

#### Create a Test User:
1. Run your app: `npm run dev`
2. Click **Sign Up**
3. Enter an email and password (min 6 characters)
4. Verify your email in Supabase Dashboard (or skip for testing)
5. Click **Sign In**
6. Use the credentials you just created

#### Default Test User:
You can also create a test user directly in Supabase:
1. Go to Supabase Dashboard → **Authentication** → **Users**
2. Click **Add user**
3. Email: `test@example.com`
4. Password: `Test123456`
5. Keep **Auto Confirm User** enabled for immediate access

### Step 5: Run Your App
```bash
npm run dev
```

## 📝 File Structure

```
rareluxe-modified/
├── src/
│   ├── App.jsx           (Updated with Supabase auth)
│   └── main.jsx
├── supabaseClient.js     (NEW - Supabase client config)
├── package.json
├── vite.config.js
├── index.html
├── capacitor.config.json
└── README_SUPABASE_SETUP.md (This file)
```

## 🔐 Authentication Flow

### Sign Up
1. User enters email and password
2. Supabase creates account (password is hashed)
3. Optional: Email verification sent (configure in Supabase settings)
4. User directed to Sign In tab

### Sign In
1. User enters registered email and password
2. Supabase validates credentials
3. Session token created
4. App redirects to dashboard
5. Session persists across browser refreshes

### Logout
1. User clicks "Out" button in header
2. `handleLogout()` calls `supabase.auth.signOut()`
3. Session cleared
4. User redirected to login screen
5. All data cleared from state

## 🔧 Advanced Configuration

### Customize Password Requirements
Edit the validation in `LoginScreen` component:
```javascript
if (password.length < 6) {
  setError("Password must be at least 6 characters long.");
}
```

### Add Email Verification
In Supabase Dashboard:
1. Go to **Authentication** → **Email Templates**
2. Configure email confirmation template
3. Users must verify email before signing in

### Enable Multi-Factor Authentication (MFA)
In Supabase Dashboard:
1. Go to **Authentication** → **Settings**
2. Enable MFA in Security section
3. Implement MFA UI in your app

### Custom User Metadata
You can store additional user info (role, permissions, etc.) in Supabase:
```javascript
// In your app, after user is authenticated:
await supabase.auth.updateUser({
  data: { role: 'admin', company: 'RareLuxe' }
});
```

## 📊 User Management in Supabase

### View All Users
1. Supabase Dashboard → **Authentication** → **Users**
2. See all registered users
3. Reset passwords, disable accounts, etc.

### Reset User Password
1. Supabase Dashboard → **Authentication** → **Users**
2. Click user row
3. Click **Reset password**
4. Email sent to user

### Delete a User
1. Supabase Dashboard → **Authentication** → **Users**
2. Click user row
3. Click **Delete user**

## 🐛 Troubleshooting

### Issue: "Invalid login credentials"
- ✓ Verify email exists in Supabase
- ✓ Check password is correct
- ✓ Ensure user email is confirmed (if required)

### Issue: "User already exists"
- ✓ Use a different email for sign up
- ✓ Or sign in with existing credentials

### Issue: Session not persisting
- ✓ Check browser localStorage is enabled
- ✓ Verify Supabase credentials in `supabaseClient.js`
- ✓ Check browser console for errors

### Issue: CORS errors
- ✓ Your Supabase URL is public - no server setup needed
- ✓ Check that ANON_KEY is correct in `supabaseClient.js`

### Issue: Email verification not working
- ✓ Configure SMTP in Supabase Dashboard
- ✓ Or disable email confirmation for testing

## 🔄 Database Integration

Your existing Supabase database (inventory, bookings tables) will work perfectly with the new auth system. The app uses the same REST API as before - only the authentication layer has changed.

### Current API Function
The `api()` function still uses:
- `SUPABASE_URL` for REST endpoints
- `SUPABASE_KEY` for API access
- `inventory` and `bookings` tables

No changes needed to data operations!

## 📱 Mobile App (Capacitor)

For mobile deployment:
1. Install Capacitor: Already in `package.json`
2. Build web version: `npm run build`
3. Add platform: `npx cap add android` or `npx cap add ios`
4. Build mobile app: `npx cap build`

## 🎯 Next Steps

1. ✅ Test sign up and sign in
2. ✅ Verify your email (if configured)
3. ✅ Create backup of Supabase project
4. ✅ Deploy to production
5. ✅ Monitor user authentication in Supabase Dashboard

## 📚 Additional Resources

- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
- [Supabase JS Client](https://supabase.com/docs/reference/javascript)
- [Supabase Security](https://supabase.com/docs/guides/auth/security)
- [Password Reset Flows](https://supabase.com/docs/guides/auth/passwords)

## ✉️ Support

For issues with authentication:
1. Check Supabase Dashboard logs
2. Review browser console errors
3. Verify credentials in `supabaseClient.js`
4. Test in Supabase Dashboard directly

---

**Setup Complete! Your app is now using secure Supabase authentication. 🎉**


---
## Inventory Codes, PDF Invoices & Collections (latest update)
1. Run `supabase/discount_migration.sql` (if not yet) and `supabase/inventory_code_migration.sql` in the Supabase SQL editor.
2. `npm install && npm run dev`
3. Vercel env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_COLLECTION_VIEWER_EMAILS=ashna@rareluxe.com` (optional `VITE_DEMO_EMAIL`).

### Android APK (Capacitor) — PDF download
The APK loads https://rare-luxe.vercel.app (see capacitor.config.json), so web changes arrive via Vercel.
PDF saving inside the APK needs two native plugins, so rebuild the APK ONCE:
```
npm install
npm run build
npx cap sync android      # (run `npx cap add android` first if the android/ folder doesn't exist)
npx cap open android      # Android Studio → Build → Build APK(s)
```
