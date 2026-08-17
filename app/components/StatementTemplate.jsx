import { formatINR } from "../utils/money";
import { paiseToWords } from "../utils/numberToWords";

function formatDate(value) {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function StatementTemplate({ customer, settings, rows, closingPaise, range }) {
  const cell = { padding: "6px 8px", fontSize: 11.5, borderBottom: "1px solid #ddd" };
  const head = {
    ...cell,
    background: "#f1f1f1",
    fontWeight: 700,
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    borderBottom: "1.5px solid #111",
  };
  const num = { textAlign: "right", fontVariantNumeric: "tabular-nums" };

  const totalCredit = rows.reduce((s, r) => s + r.creditPaise, 0);
  const totalDebit = rows.reduce((s, r) => s + r.debitPaise, 0);

  return (
    <div
      className="statement-page"
      style={{
        width: "210mm",
        minHeight: "297mm",
        margin: "0 auto",
        padding: "13mm",
        background: "#fff",
        color: "#111",
        fontFamily: "'Helvetica Neue', Arial, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ display: "flex", gap: 12 }}>
          {settings.showLogo && settings.logoUrl && (
            <img src={settings.logoUrl} alt="" style={{ maxWidth: 64, maxHeight: 64 }} />
          )}
          <div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{settings.storeName || "Store"}</div>
            <div style={{ fontSize: 10.5, color: "#444", lineHeight: 1.45 }}>
              {[settings.storeAddress, [settings.storeCity, settings.storeState, settings.storePincode]
                .filter(Boolean).join(", ")].filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
              {settings.storeTel && <div>Ph: {settings.storeTel}</div>}
              {settings.storeGstin && <div>GSTIN: {settings.storeGstin}</div>}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1.5 }}>ADVANCE LEDGER</div>
          <div style={{ fontSize: 10.5, color: "#444" }}>
            {range?.from || range?.to
              ? `${range.from ? formatDate(range.from) : "Beginning"} – ${range.to ? formatDate(range.to) : "Today"}`
              : "All transactions"}
          </div>
          <div style={{ fontSize: 10, color: "#777", marginTop: 2 }}>
            Generated {formatDate(new Date())}
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          padding: "9px 11px",
          border: "1.5px solid #111",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 9.5, textTransform: "uppercase", color: "#555", letterSpacing: 0.5 }}>
            Customer
          </div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{customer.customerName}</div>
          <div style={{ fontSize: 11, color: "#444" }}>
            {[customer.customerPhone, customer.customerEmail].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9.5, textTransform: "uppercase", color: "#555", letterSpacing: 0.5 }}>
            Credit balance
          </div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{formatINR(closingPaise)}</div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
        <thead>
          <tr>
            <th style={{ ...head, width: "12%" }}>Date</th>
            <th style={{ ...head, width: "30%" }}>Particulars</th>
            <th style={{ ...head, width: "16%" }}>Reference</th>
            <th style={{ ...head, ...num, width: "14%" }}>Credit</th>
            <th style={{ ...head, ...num, width: "14%" }}>Debit</th>
            <th style={{ ...head, ...num, width: "14%" }}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td style={{ ...cell, textAlign: "center", color: "#777" }} colSpan={6}>
                No transactions in this period.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={cell}>{formatDate(r.entryDate)}</td>
              <td style={cell}>
                {r.label}
                {r.note && <div style={{ fontSize: 9.5, color: "#666" }}>{r.note}</div>}
              </td>
              <td style={{ ...cell, fontSize: 10.5 }}>
                {[r.receiptNo, r.orderName].filter(Boolean).join(" · ") || "—"}
              </td>
              <td style={{ ...cell, ...num }}>{r.creditPaise ? formatINR(r.creditPaise) : ""}</td>
              <td style={{ ...cell, ...num }}>{r.debitPaise ? formatINR(r.debitPaise) : ""}</td>
              <td style={{ ...cell, ...num, fontWeight: 600 }}>{formatINR(r.balancePaise)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ ...cell, fontWeight: 700, borderTop: "1.5px solid #111" }} colSpan={3}>
              Totals
            </td>
            <td style={{ ...cell, ...num, fontWeight: 700, borderTop: "1.5px solid #111" }}>
              {formatINR(totalCredit)}
            </td>
            <td style={{ ...cell, ...num, fontWeight: 700, borderTop: "1.5px solid #111" }}>
              {formatINR(totalDebit)}
            </td>
            <td style={{ ...cell, ...num, fontWeight: 800, borderTop: "1.5px solid #111" }}>
              {formatINR(closingPaise)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div style={{ marginTop: 12, fontSize: 11 }}>
        <strong>Closing balance in words: </strong>
        <em>{paiseToWords(closingPaise)}</em>
      </div>

      <div style={{ marginTop: 26, display: "flex", justifyContent: "space-between", fontSize: 10.5 }}>
        <div style={{ color: "#666", maxWidth: "60%", lineHeight: 1.5 }}>
          {settings.footerText}
          <div style={{ marginTop: 3 }}>
            Please report any discrepancy within 7 days of receiving this statement.
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ height: 42 }} />
          <div style={{ borderTop: "1px solid #111", paddingTop: 4, minWidth: 150 }}>
            Authorised Signatory
          </div>
        </div>
      </div>
    </div>
  );
}
