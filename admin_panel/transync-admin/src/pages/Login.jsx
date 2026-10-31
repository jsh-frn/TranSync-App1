import { useState } from "react";
import { useNavigate } from 'react-router-dom'

// 👇 Place your assets in src/assets/ and update these imports
import TranSyncLogo from "../assets/TranSync_Logo.png";
import BusIcon from "../assets/bus_icon.png";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Please fill in all fields.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Login failed.");
      } else {
        localStorage.setItem("admin", JSON.stringify(data.admin));
        localStorage.setItem("admin_token", data.session_token);
        navigate('/overview')
      }
    } catch (err) {
      setError("Cannot connect to server. Make sure XAMPP is running.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ fontFamily: "'Segoe UI', sans-serif", backgroundColor: "#245665" }}>

      {/* ── TOP HEADER BANNER ── */}
      <div
        className="w-full px-5 sm:px-10 py-6 sm:py-8 flex items-center justify-between gap-4"
        style={{ backgroundColor: "#245665" }}
      >
        <div className="min-w-0">
          <h1 className="text-white font-black text-3xl sm:text-5xl leading-tight tracking-tight">
            <span className="text-white">T</span>ran
            <span style={{ color: "#B9E147" }}>S</span>ync
          </h1>
          <p
            className="mt-2 text-xs sm:text-sm font-bold leading-snug"
            style={{
              color: "#B9E147",
              fontFamily: "'Courier New', monospace",
              letterSpacing: "0.04em",
            }}
          >
            Integrated Public Transportation<br />
            System for Pampanga
          </p>
        </div>

        {/* Bus Icon Circle */}
        <div
          className="w-14 h-14 sm:w-24 sm:h-24 rounded-full border-4 border-white flex items-center justify-center overflow-hidden shadow-xl shrink-0"
          style={{ backgroundColor: "#245665" }}
        >
          <img src={BusIcon} alt="TranSync Bus" className="w-9 h-9 sm:w-16 sm:h-16 object-contain" />
        </div>
      </div>

      {/* ── MAIN CARD AREA ── */}
      <div className="flex-1 bg-white rounded-t-3xl mt-8 mx-2 sm:mx-6 shadow-2xl flex items-center justify-center px-4 sm:px-6 py-10 sm:py-14">
        <div className="w-full max-w-3xl flex flex-col md:flex-row items-center gap-8 sm:gap-12">

          {/* ── LEFT: Branding ── */}
          <div className="flex flex-col items-center md:items-start text-center md:text-left flex-1">
            <img
              src={TranSyncLogo}
              alt="TranSync Logo"
              className="w-36 h-36 object-contain mb-6 drop-shadow-xl"
            />
            <h2
              className="text-4xl sm:text-5xl font-black italic leading-tight"
              style={{ color: "#245665" }}
            >
              Welcome to<br />TranSync!
            </h2>
            <p className="mt-3 text-lg text-slate-400 font-medium">
              Sign in to your account
            </p>
            <div
              className="mt-6 h-1 w-20 rounded-full"
              style={{ backgroundColor: "#B9E147" }}
            />
          </div>

          {/* ── RIGHT: Form ── */}
          <div className="flex-1 w-full">
            <div className="bg-white border border-slate-200 rounded-2xl shadow-lg px-5 sm:px-8 py-7 sm:py-9">

              {error && (
                <div className="mb-5 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-500 text-sm flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </div>
              )}

              <div className="space-y-6">

                {/* Email */}
                <div>
                  <div className="mb-2">
                    <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email Address"
                    className="w-full border border-slate-300 rounded-lg px-4 py-3 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-[#245665] focus:ring-2 focus:ring-[#245665]/10 transition-all"
                  />
                </div>

                {/* Password */}
                <div>
                  <div className="mb-2">
                    <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      className="w-full border border-slate-300 rounded-lg px-4 py-3 pr-10 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-[#245665] focus:ring-2 focus:ring-[#245665]/10 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showPassword ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Remember Me */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setRememberMe(!rememberMe)}
                    className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all ${
                      rememberMe
                        ? "border-[#B9E147] bg-[#B9E147]"
                        : "border-slate-300 bg-white hover:border-slate-400"
                    }`}
                  >
                    {rememberMe && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <span
                    className="text-sm text-slate-500 cursor-pointer select-none"
                    onClick={() => setRememberMe(!rememberMe)}
                  >
                    Remember me
                  </span>
                </div>

                {/* Sign In Button */}
                <button
                  onClick={handleSubmit}
                  disabled={isLoading}
                  className="w-full py-3 rounded-xl font-bold text-sm tracking-wide shadow-md hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{ backgroundColor: "#B9E147", color: "#1a2a10" }}
                >
                  {isLoading ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Signing in...
                    </>
                  ) : (
                    "Sign in"
                  )}
                </button>

              </div>
            </div>

            <p className="text-center text-xs text-slate-400 mt-5">
              © {new Date().getFullYear()} TranSync · Integrated Public Transportation System for Pampanga
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}