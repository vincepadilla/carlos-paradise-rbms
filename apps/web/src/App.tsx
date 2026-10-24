import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router";
import axios from "axios";
import LandingPage from "./pages/LandingPage";
import VillaPage from "./pages/VillaPage";

import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";

export default function App() {
  useEffect(() => {
    const controller = new AbortController();

    axios
      .get("http://127.0.0.1:8000/api/health", {
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
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/villa" element={<VillaPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<SignupPage />} />
      </Routes>
    </BrowserRouter>
  );
}