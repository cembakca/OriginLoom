import { useEffect, useState } from "react";

/**
 * Tarayıcıda çalışan saat widget'ı.
 * Sayfanın cache durumundan bağımsız olarak her yüklemede güncel
 * zamanı gösterir — fragment cache demo'sunun "dinamik" tarafını temsil eder.
 */
export default function ClientClock() {
  const [time, setTime] = useState<string>("—");

  useEffect(() => {
    setTime(new Date().toLocaleTimeString("tr-TR"));
  }, []);

  return (
    <div
      id="client-clock"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 font-mono text-sm border border-emerald-200"
    >
      <span>🕐 Tarayıcı Saati:</span>
      <strong>{time}</strong>
    </div>
  );
}
