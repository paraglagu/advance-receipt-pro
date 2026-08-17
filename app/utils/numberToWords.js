const ones = [
  "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE",
  "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN",
  "SEVENTEEN", "EIGHTEEN", "NINETEEN",
];
const tens = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

function belowHundred(n) {
  n = Math.floor(n);
  if (n <= 0) return "";
  if (n < 20) return ones[n] || "";
  const t = tens[Math.floor(n / 10)] || "";
  const o = ones[n % 10] || "";
  return o ? `${t} ${o}` : t;
}

function belowThousand(n) {
  n = Math.floor(n);
  if (n <= 0) return "";
  const h = Math.floor(n / 100);
  const rem = n % 100;
  const hundredPart = h > 0 ? `${ones[h]} HUNDRED` : "";
  const restPart = belowHundred(rem);
  if (hundredPart && restPart) return `${hundredPart} ${restPart}`;
  return hundredPart || restPart;
}

function belowLakh(n) {
  n = Math.floor(n);
  if (n <= 0) return "";
  if (n < 1000) return belowThousand(n);
  const th = Math.floor(n / 1000);
  const rem = n % 1000;
  const thPart = belowThousand(th) + " THOUSAND";
  const remPart = belowThousand(rem);
  return remPart ? `${thPart} ${remPart}` : thPart;
}

function rupeeWords(n) {
  n = Math.floor(n);
  if (n <= 0) return "ZERO";
  const crore = Math.floor(n / 10000000);
  const lakh  = Math.floor((n % 10000000) / 100000);
  const rest  = n % 100000;
  const parts = [];
  if (crore) parts.push(belowThousand(crore) + " CRORE");
  if (lakh)  parts.push(belowHundred(lakh) + " LAKH");
  if (rest)  parts.push(belowLakh(rest));
  return parts.filter(Boolean).join(" ") || "ZERO";
}

/** Takes integer paise so it agrees exactly with the printed figure. */
export function paiseToWords(paise) {
  const p = Math.abs(Math.round(Number(paise) || 0));
  const rupees = Math.floor(p / 100);
  const paiseRem = p % 100;
  let result = rupeeWords(rupees) + " RUPEES";
  if (paiseRem > 0) result += ` AND ${belowHundred(paiseRem)} PAISE`;
  return result + " ONLY";
}
