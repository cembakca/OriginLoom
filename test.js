import autocannon from "autocannon";

const tests = [
  { title: "1. Yeni yapılan proje", url: `http://localhost:3005/blogs/paginated?page=2` },
  {
    title: "2. Nextjs ile aynı sayfanın çalışması",
    url: `http://localhost:3006/blogs/paginated?page=2`,
  },
];

async function runTest(test) {
  return new Promise((resolve) => {
    console.log(`\n=========================================`);
    console.log(`Çalıştırılıyor: ${test.title}`);
    console.log(`=========================================\n`);

    autocannon(
      {
        url: test.url,
        connections: 50,
        duration: 15,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/134.0.0.0",
        },
      },
      (err, result) => {
        if (err) return console.error(err);

        console.log(`İstek/saniye (RPS):  ${result.requests.mean.toLocaleString()} (Ortalama)`);
        console.log(`Gecikme (Avg ms):   ${result.latency.mean.toFixed(2)} ms`);
        console.log(`Hatalar:            ${result.errors}`);
        resolve();
      },
    );
  });
}

async function main() {
  console.log("\n⏳ Testler 10 saniye içinde başlayacak...\n");
  await new Promise((r) => setTimeout(r, 10000));

  for (const test of tests) {
    await runTest(test);
    console.log("-----------------------------------------");
  }
  console.log("\n✅ Tüm testler tamamlandı.");
}

main();
