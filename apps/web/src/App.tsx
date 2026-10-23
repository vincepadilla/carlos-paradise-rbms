import { useEffect } from "react";
import axios from "axios";
import LandingPage from "./pages/LandingPage";

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

  return <LandingPage />;
}