# Rare Luxe - Quick Start Guide

## 🚀 Get Running in 5 Minutes

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Server
```bash
npm run dev
```
App will be available at `http://localhost:5173`

### 3. Create a Test Account
1. Click **Sign Up**
2. Email: `test@example.com`
3. Password: `Test123456`
4. Click **Sign Up →**
5. Then **Sign In** with the same credentials

### ✅ That's it! You're authenticated.

---

## 📝 Quick Reference

### Sign In
- Email: `test@example.com`
- Password: `Test123456`

### Reset Test Credentials
1. Go to Supabase Dashboard
2. **Authentication** → **Users**
3. Delete test user
4. Create new test user

### Need Help?
- Read: `README_SUPABASE_SETUP.md` (Detailed setup guide)
- Read: `CHANGES_SUMMARY.md` (What was changed)
- Check: Browser console for errors
- Check: Supabase Dashboard for user logs

---

## 🎯 Common Tasks

### Create New User
In app: **Sign Up** tab → Enter email & password → Click **Sign Up →**

### Sign In Existing User
**Sign In** tab → Enter email & password → Click **Sign In →**

### Logout
Click **Out** button in top-right corner

### Manage Users
Visit: https://app.supabase.com → **Authentication** → **Users**

---

## 📱 Build for Production

### Web Build
```bash
npm run build
```
Creates optimized build in `dist/` folder

### Mobile Build (Capacitor)
```bash
npx cap add android
npx cap build
```

---

## 🔍 Debug Authentication

### Check Auth Status
Open browser console:
```javascript
import { supabase } from './supabaseClient';
const { data: { session } } = await supabase.auth.getSession();
console.log(session?.user);
```

### View Auth Logs
1. Supabase Dashboard
2. **Logs** → **Auth**

### Test API Call
```javascript
const { data: { user } } = await supabase.auth.getUser();
console.log(user);
```

---

## ⚠️ Common Issues

| Issue | Solution |
|-------|----------|
| "Invalid credentials" | Verify email/password in Supabase Users list |
| Login doesn't work | Clear browser cache & localStorage |
| Session lost on refresh | Check localStorage is enabled |
| "User already exists" | Use different email or reset in Supabase |

---

## 📚 Learn More

- **Supabase Docs:** https://supabase.com/docs
- **Auth Guide:** https://supabase.com/docs/guides/auth
- **JS Client:** https://supabase.com/docs/reference/javascript

---

**Ready to build? Run `npm run dev` and start coding! 🚀**
