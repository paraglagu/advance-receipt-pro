import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { ReceiptTemplate } from "../components/ReceiptTemplate";
import { getReceiptById } from "../models/receipt.server";
import { getSettings } from "../models/settings.server";
import { getCustomerBalance } from "../models/ledger.server";

export const loader = async ({ params, request }) => {
  const receipt = await getReceiptById(params.id);
  if (!receipt) throw new Response("Receipt not found", { status: 404 });

  const settings = await getSettings(receipt.shop);
  const balanceAfterPaise = await getCustomerBalance(receipt.shop, receipt.customerId);

  const url = new URL(request.url);
  const sizeOverride = url.searchParams.get("size");
  const autoPrint = url.searchParams.get("auto") === "1";

  return json({
    receipt,
    settings: sizeOverride ? { ...settings, pageSize: sizeOverride } : settings,
    balanceAfterPaise,
    autoPrint,
  });
};

export default function PrintReceiptPage() {
  const { receipt, settings, balanceAfterPaise, autoPrint } = useLoaderData();
  const thermal = settings.pageSize === "THERMAL80";
  const pageRule = thermal ? "80mm auto" : settings.pageSize;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>{`Advance Receipt ${receipt.receiptNo}`}</title>
        <style>{`
          * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body { margin: 0; padding: 0; background: #fff; }
          @media print {
            body { margin: 0; background: #fff; }
            .no-print { display: none !important; }
            @page { size: ${pageRule}; margin: ${thermal ? "0" : "6mm"}; }
          }
          @media screen {
            body { background: #e5e5e5; padding: 20px 12px 40px; }
            .receipt-page { box-shadow: 0 2px 10px rgba(0,0,0,0.25); }
          }
        `}</style>
      </head>
      <body>
        <div className="no-print" style={{ textAlign: "center", marginBottom: 16 }}>
          <button
            onClick={() => window.print()}
            style={btn("#008060", "#fff")}
          >
            🖨 Print receipt
          </button>
          <a href={`?size=THERMAL80`} style={link(settings.pageSize === "THERMAL80")}>80mm</a>
          <a href={`?size=A5`} style={link(settings.pageSize === "A5")}>A5</a>
          <a href={`?size=A4`} style={link(settings.pageSize === "A4")}>A4</a>
          <button onClick={() => window.close()} style={btn("#d7d7d7", "#111")}>Close</button>
        </div>

        <ReceiptTemplate
          receipt={receipt}
          settings={settings}
          balanceAfterPaise={balanceAfterPaise}
        />

        {autoPrint && (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 350); });`,
            }}
          />
        )}
      </body>
    </html>
  );
}

function btn(bg, color) {
  return {
    padding: "10px 22px",
    fontSize: 14,
    background: bg,
    color,
    border: "none",
    borderRadius: 5,
    cursor: "pointer",
    margin: "0 5px",
    fontFamily: "system-ui, sans-serif",
  };
}

function link(active) {
  return {
    display: "inline-block",
    padding: "9px 15px",
    fontSize: 13,
    background: active ? "#111" : "#fff",
    color: active ? "#fff" : "#111",
    border: "1px solid #999",
    borderRadius: 5,
    textDecoration: "none",
    margin: "0 3px",
    fontFamily: "system-ui, sans-serif",
  };
}
