import { productSummary } from "../utils/domain";
import { formatINR, modeLabel } from "../utils/money";
import { paiseToWords } from "../utils/numberToWords";

function formatDateTime(value) {
  const d = new Date(value);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function storeLines(s) {
  return [
    [s.storeAddress].filter(Boolean).join(""),
    [s.storeCity, s.storeState, s.storePincode].filter(Boolean).join(", "),
    s.storeTel ? `Ph: ${s.storeTel}` : null,
    s.storeEmail || null,
    s.storeGstin ? `GSTIN: ${s.storeGstin}` : null,
  ].filter(Boolean);
}

export function ReceiptTemplate({ receipt, settings, balanceAfterPaise }) {
  const thermal = (settings.pageSize || "THERMAL80") === "THERMAL80";
  return thermal ? (
    <ThermalReceipt receipt={receipt} settings={settings} balanceAfterPaise={balanceAfterPaise} />
  ) : (
    <VoucherReceipt receipt={receipt} settings={settings} balanceAfterPaise={balanceAfterPaise} />
  );
}

/* ------------------------------------------------------------------ */
/* 80mm thermal roll — what the counter printer will actually produce  */
/* ------------------------------------------------------------------ */

function ThermalReceipt({ receipt, settings, balanceAfterPaise }) {
  const rule = { borderTop: "1px dashed #000", margin: "6px 0" };
  const row = { display: "flex", justifyContent: "space-between", gap: 8, lineHeight: 1.45 };
  const voided = receipt.status === "VOID";

  return (
    <div
      className="receipt-page"
      style={{
        width: "72mm",
        margin: "0 auto",
        padding: "4mm 2mm",
        background: "#fff",
        color: "#000",
        fontFamily: "'Courier New', ui-monospace, monospace",
        fontSize: 12,
        position: "relative",
      }}
    >
      {voided && <VoidStamp />}

      <div style={{ textAlign: "center" }}>
        {settings.showLogo && settings.logoUrl && (
          <img
            src={settings.logoUrl}
            alt=""
            style={{ maxWidth: "40mm", maxHeight: "18mm", marginBottom: 4 }}
          />
        )}
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.5 }}>
          {settings.storeName || "Store"}
        </div>
        {storeLines(settings).map((line, i) => (
          <div key={i} style={{ fontSize: 10.5, lineHeight: 1.35 }}>{line}</div>
        ))}
      </div>

      <div style={rule} />
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: 13, letterSpacing: 1 }}>
        ADVANCE RECEIPT
      </div>
      <div style={{ textAlign: "center", fontSize: 10 }}>(Receipt Voucher)</div>
      <div style={rule} />

      <div style={row}><span>Receipt No</span><strong>{receipt.receiptNo}</strong></div>
      <div style={row}><span>Date</span><span>{formatDateTime(receipt.receiptDate)}</span></div>
      {receipt.staffName && (
        <div style={row}><span>Received by</span><span>{receipt.staffName}</span></div>
      )}

      <div style={rule} />

      <div style={{ lineHeight: 1.45 }}>
        <div style={{ fontSize: 10.5, textTransform: "uppercase", opacity: 0.75 }}>Received from</div>
        <div style={{ fontWeight: 700 }}>{receipt.customerName}</div>
        {receipt.customerPhone && <div>{receipt.customerPhone}</div>}
        {receipt.customerEmail && <div style={{ fontSize: 10.5 }}>{receipt.customerEmail}</div>}
      </div>

      {productSummary(receipt) && (
        <>
          <div style={rule} />
          <div style={{ lineHeight: 1.45 }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", opacity: 0.75 }}>
              Advance against
            </div>
            <div style={{ fontWeight: 700 }}>{productSummary(receipt)}</div>
            {!receipt.productListed && (
              <div style={{ fontSize: 10 }}>(to be arranged / not yet in stock)</div>
            )}
          </div>
        </>
      )}

      <div style={rule} />

      <div style={row}><span>Mode</span><span>{modeLabel(receipt.mode)}</span></div>
      {receipt.reference && (
        <div style={row}><span>Ref</span><span style={{ textAlign: "right" }}>{receipt.reference}</span></div>
      )}

      <div style={rule} />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 16,
          fontWeight: 700,
          padding: "4px 0",
        }}
      >
        <span>ADVANCE PAID</span>
        <span>{formatINR(receipt.amountPaise)}</span>
      </div>

      <div style={{ fontSize: 10.5, lineHeight: 1.4, marginTop: 2 }}>
        <em>{paiseToWords(receipt.amountPaise)}</em>
      </div>

      <div style={rule} />

      {typeof balanceAfterPaise === "number" && (
        <>
          <div style={{ ...row, fontWeight: 700 }}>
            <span>TOTAL CREDIT BALANCE</span>
            <span>{formatINR(balanceAfterPaise)}</span>
          </div>
          <div style={{ fontSize: 10, opacity: 0.8, lineHeight: 1.35 }}>
            Balance across all your advances with us as on date.
          </div>
          <div style={rule} />
        </>
      )}

      {settings.declarationText && (
        <div style={{ fontSize: 10.5, lineHeight: 1.4, textAlign: "center", margin: "6px 0" }}>
          {settings.declarationText}
        </div>
      )}

      {settings.termsText && (
        <>
          <div style={rule} />
          <div style={{ fontSize: 9.5, lineHeight: 1.4, whiteSpace: "pre-line" }}>
            {settings.termsText}
          </div>
        </>
      )}

      <div style={{ height: 28 }} />
      <div style={{ textAlign: "right", fontSize: 10.5 }}>
        <div style={{ borderTop: "1px solid #000", display: "inline-block", padding: "3px 12px 0" }}>
          Authorised Signatory
        </div>
      </div>

      <div style={rule} />
      <div style={{ textAlign: "center", fontSize: 9.5, lineHeight: 1.4 }}>
        {settings.footerText && <div>{settings.footerText}</div>}
        <div style={{ marginTop: 3, fontWeight: 700 }}>Please retain this receipt</div>
        {settings.poweredByText && (
          <div style={{ marginTop: 4, opacity: 0.7 }}>{settings.poweredByText}</div>
        )}
      </div>
      <div style={{ height: "8mm" }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A5 / A4 voucher — for a formal, filed copy                          */
/* ------------------------------------------------------------------ */

function VoucherReceipt({ receipt, settings, balanceAfterPaise }) {
  const isA4 = settings.pageSize === "A4";
  const cell = { padding: "7px 10px", fontSize: 12.5, verticalAlign: "top" };
  const labelCell = {
    ...cell,
    width: "32%",
    color: "#444",
    textTransform: "uppercase",
    fontSize: 10.5,
    letterSpacing: 0.4,
  };
  const voided = receipt.status === "VOID";

  return (
    <div
      className="receipt-page"
      style={{
        width: isA4 ? "210mm" : "148mm",
        minHeight: isA4 ? "297mm" : "210mm",
        margin: "0 auto",
        padding: isA4 ? "14mm" : "9mm",
        background: "#fff",
        color: "#111",
        fontFamily: "'Helvetica Neue', Arial, sans-serif",
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      {voided && <VoidStamp />}

      <div style={{ border: "1.5px solid #111", padding: 0 }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
            padding: "10px 12px",
            borderBottom: "1.5px solid #111",
          }}
        >
          {settings.showLogo && settings.logoUrl && (
            <img src={settings.logoUrl} alt="" style={{ maxWidth: 68, maxHeight: 68 }} />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.2 }}>
              {settings.storeName || "Store"}
            </div>
            {storeLines(settings).map((line, i) => (
              <div key={i} style={{ fontSize: 10.5, color: "#333", lineHeight: 1.4 }}>{line}</div>
            ))}
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            textAlign: "center",
            padding: "7px 0",
            borderBottom: "1.5px solid #111",
            background: "#f3f3f3",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 2 }}>ADVANCE RECEIPT</div>
          <div style={{ fontSize: 10, color: "#444", letterSpacing: 0.5 }}>RECEIPT VOUCHER</div>
        </div>

        {/* Meta */}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr style={{ borderBottom: "1px solid #ccc" }}>
              <td style={labelCell}>Receipt No.</td>
              <td style={{ ...cell, fontWeight: 700 }}>{receipt.receiptNo}</td>
              <td style={labelCell}>Date</td>
              <td style={cell}>{formatDateTime(receipt.receiptDate)}</td>
            </tr>
            <tr style={{ borderBottom: "1.5px solid #111" }}>
              <td style={labelCell}>Received from</td>
              <td style={{ ...cell, fontWeight: 700 }} colSpan={3}>
                {receipt.customerName}
                {receipt.customerPhone && (
                  <span style={{ fontWeight: 400, color: "#444" }}> · {receipt.customerPhone}</span>
                )}
                {receipt.customerEmail && (
                  <div style={{ fontWeight: 400, fontSize: 11, color: "#444" }}>
                    {receipt.customerEmail}
                  </div>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Amount block */}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {productSummary(receipt) && (
              <tr style={{ borderBottom: "1px solid #ccc" }}>
                <td style={labelCell}>Advance against</td>
                <td style={{ ...cell, fontWeight: 600 }} colSpan={3}>
                  {productSummary(receipt)}
                  {!receipt.productListed && (
                    <span style={{ fontWeight: 400, color: "#555" }}>
                      {" "}— to be arranged
                    </span>
                  )}
                </td>
              </tr>
            )}
            <tr style={{ borderBottom: "1px solid #ccc" }}>
              <td style={labelCell}>Payment mode</td>
              <td style={cell}>{modeLabel(receipt.mode)}</td>
              <td style={labelCell}>Reference</td>
              <td style={cell}>{receipt.reference || "—"}</td>
            </tr>
            <tr style={{ borderBottom: "1px solid #ccc" }}>
              <td style={{ ...cell, fontWeight: 700, fontSize: 14 }} colSpan={2}>
                ADVANCE AMOUNT RECEIVED
              </td>
              <td style={{ ...cell, textAlign: "right", fontWeight: 700, fontSize: 18 }} colSpan={2}>
                {formatINR(receipt.amountPaise)}
              </td>
            </tr>
            <tr style={{ borderBottom: "1.5px solid #111" }}>
              <td style={labelCell}>In words</td>
              <td style={{ ...cell, fontStyle: "italic" }} colSpan={3}>
                {paiseToWords(receipt.amountPaise)}
              </td>
            </tr>
            {typeof balanceAfterPaise === "number" && (
              <tr style={{ borderBottom: "1.5px solid #111", background: "#f7f7f7" }}>
                <td style={{ ...cell, fontWeight: 700 }} colSpan={2}>
                  TOTAL CREDIT BALANCE
                  <div style={{ fontWeight: 400, fontSize: 10, color: "#555" }}>
                    Across all advances, as on date
                  </div>
                </td>
                <td style={{ ...cell, textAlign: "right", fontWeight: 700, fontSize: 15 }} colSpan={2}>
                  {formatINR(balanceAfterPaise)}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {receipt.note && (
          <div style={{ padding: "7px 10px", fontSize: 11, borderBottom: "1px solid #ccc" }}>
            <strong>Note: </strong>{receipt.note}
          </div>
        )}

        {settings.declarationText && (
          <div style={{ padding: "9px 10px", fontSize: 11.5, borderBottom: "1px solid #ccc" }}>
            {settings.declarationText}
          </div>
        )}

        {/* Signature */}
        <div style={{ display: "flex", borderBottom: "1px solid #ccc" }}>
          <div style={{ flex: 1, padding: "10px", fontSize: 10, borderRight: "1px solid #ccc" }}>
            {settings.termsText && (
              <div style={{ whiteSpace: "pre-line", color: "#333", lineHeight: 1.5 }}>
                {settings.termsText}
              </div>
            )}
          </div>
          <div style={{ width: "38%", padding: "10px", textAlign: "center", fontSize: 11 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>
              For {settings.storeName || "Store"}
            </div>
            <div style={{ height: 46 }} />
            <div style={{ borderTop: "1px solid #111", paddingTop: 4 }}>Authorised Signatory</div>
          </div>
        </div>

        <div style={{ padding: "6px 10px", textAlign: "center", fontSize: 9.5, color: "#555" }}>
          {settings.footerText}
          {settings.poweredByText && <span> · {settings.poweredByText}</span>}
        </div>
      </div>
    </div>
  );
}

function VoidStamp() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <div
        style={{
          transform: "rotate(-24deg)",
          border: "4px solid #c00",
          color: "#c00",
          fontSize: 40,
          fontWeight: 800,
          letterSpacing: 6,
          padding: "4px 22px",
          opacity: 0.55,
        }}
      >
        VOID
      </div>
    </div>
  );
}
