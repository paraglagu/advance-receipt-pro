import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { StatementTemplate } from "../components/StatementTemplate";
import prisma from "../db.server";
import { getSettings } from "../models/settings.server";
import { getCustomerStatement } from "../models/ledger.server";

export const loader = async ({ params, request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) throw new Response("Missing shop", { status: 400 });

  // Only render for shops that have actually installed the app.
  const installed = await prisma.session.findFirst({ where: { shop } });
  if (!installed) throw new Response("Unknown shop", { status: 404 });

  const customerId = params.customerId;
  const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")) : null;
  const to = url.searchParams.get("to") ? new Date(`${url.searchParams.get("to")}T23:59:59`) : null;

  const { rows, closingPaise } = await getCustomerStatement(shop, customerId, { from, to });

  const latest = await prisma.advanceReceipt.findFirst({
    where: { shop, customerId },
    orderBy: { createdAt: "desc" },
    select: { customerName: true, customerPhone: true, customerEmail: true },
  });
  if (!latest && rows.length === 0) throw new Response("No ledger for this customer", { status: 404 });

  const settings = await getSettings(shop);

  return json({
    customer: {
      customerId,
      customerName: latest?.customerName || "Customer",
      customerPhone: latest?.customerPhone || null,
      customerEmail: latest?.customerEmail || null,
    },
    settings,
    rows,
    closingPaise,
    range: { from: from?.toISOString() || null, to: to?.toISOString() || null },
    autoPrint: url.searchParams.get("auto") === "1",
  });
};

export default function PrintStatementPage() {
  const { customer, settings, rows, closingPaise, range, autoPrint } = useLoaderData();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>{`Advance Ledger — ${customer.customerName}`}</title>
        <style>{`
          * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body { margin: 0; padding: 0; background: #fff; }
          @media print {
            body { margin: 0; }
            .no-print { display: none !important; }
            @page { size: A4; margin: 0; }
            thead { display: table-header-group; }
            tr { break-inside: avoid; }
          }
          @media screen {
            body { background: #e5e5e5; padding: 20px 12px 40px; }
            .statement-page { box-shadow: 0 2px 10px rgba(0,0,0,0.25); }
          }
        `}</style>
      </head>
      <body>
        <div className="no-print" style={{ textAlign: "center", marginBottom: 16 }}>
          <button
            onClick={() => window.print()}
            style={{
              padding: "10px 22px", fontSize: 14, background: "#008060", color: "#fff",
              border: "none", borderRadius: 5, cursor: "pointer", marginRight: 8,
              fontFamily: "system-ui, sans-serif",
            }}
          >
            🖨 Print statement
          </button>
          <button
            onClick={() => window.close()}
            style={{
              padding: "10px 18px", fontSize: 14, background: "#d7d7d7", color: "#111",
              border: "none", borderRadius: 5, cursor: "pointer",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            Close
          </button>
        </div>

        <StatementTemplate
          customer={customer}
          settings={settings}
          rows={rows}
          closingPaise={closingPaise}
          range={range}
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
