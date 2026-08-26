# Relay Platform — Login + Admin-Managed Groups

Mukammal chat system: ek hi link, log khud register/login karein, aor **sirf aap (admin)** decide karte hain kon kis group me hy.

## Ye kis tarah kaam karta hy

1. Aap ye app host karte hain (neeche steps hain) → aapko ek link milta hy, jaise `https://relay-xxxx.onrender.com`
2. **Yehi ek link** sab ko bhej dein
3. Har banda us link par jaa k **"Account banayen"** se apna username/password khud bana leta hy aor login ho jata hy
4. Jab tak aap unko kisi group me na daalein, unhe "abhi tak kisi group me shamil nahi kiye gaye" dikhega
5. **Aap** apne account se login karein (neeche admin credentials) → top-left me **"Admin panel"** button dabayen
6. Wahan se:
   - Naya group banayen
   - "Manage" dabayen → registered users me se kisi ko bhi **Add** ya **Remove** kar dein
7. Jise aap add karenge, uske group list me foran (real-time) wo group aajaega aor wo chat kar sakega

Sab kuch — accounts, groups, membership, chat — **isi ek app/link se** control hota hy, jaisa aap ne chaha tha.

## Admin login (default)

- **Username:** `admin`
- **Password:** `admin123`

Deploy karte waqt in do environment variables se change kar dein (zaroor karein):
```
ADMIN_USERNAME=apka_username
ADMIN_PASSWORD=ek_mazboot_password
```

## Free hosting — Render.com

1. Ye folder GitHub repo me upload karein
2. [render.com](https://render.com) → **New + → Web Service** → apni repo select karein
3. Settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment → Add `ADMIN_USERNAME` aor `ADMIN_PASSWORD`
   - Instance Type: Free
4. Deploy dabayen — 2-3 minute me live link mil jaega

## Apne computer par test karna

```bash
npm install
npm start
```
Phir `http://localhost:3000` kholein.

## Zaroori notes

- Data (users/groups/messages) `data.json` file me save hota hy — free hosting par agar service redeploy/restart ho to kabhi kabhi file storage reset ho sakta hy. Permanent chahiye to real database (Postgres) add karwa lein — bata dein, madad kar dunga.
- Login sessions server ki memory me hain — server restart hone par sab ko dobara login karna paray ga.
- Filhal koi user khud apna password reset nahi kar sakta — wo feature bhi add ho sakta hy agar chahiye.
