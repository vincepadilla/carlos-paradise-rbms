import { lazy, Suspense, useEffect } from "react";
import { Routes, Route } from "react-router";
import axios from "axios";
import LandingPage from "./pages/LandingPage";
import VillaPage from "./pages/VillaPage";

import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ReservationRoute from "./pages/ReservationRoute";
import { apiBaseUrl } from "./services/ReservationApi";

const AdminRoutes = lazy(() => import("./pages/admin/AdminRoutes"));

export default function App() {
  useEffect(() => {
    const controller = new AbortController();

    axios
      .get(`${apiBaseUrl}/api/health`, {
        signal: controller.signal,
      })
      .then((response) => {
        console.log("Laravel API connected:", response.data.message);
      })
      .catch((error: unknown) => {
        if (!axios.isCancel(error)) {
          console.error("Cannot connect to Laravel API");
        }
      });

    return () => controller.abort();
  }, []);

  return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/villa" element={<VillaPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<SignupPage />} />
        <Route path="/admin/*" element={
          <Suspense fallback={<p role="status" className="p-10 text-center">Loading…</p>}>
            <AdminRoutes />
          </Suspense>
        } />
        <Route path="/make-reservation" element={<ReservationRoute />} />
        <Route
          path="/dashboard"
          element={<ReservationRoute initialPage="dashboard" />}
        />
      </Routes>
  );
}
