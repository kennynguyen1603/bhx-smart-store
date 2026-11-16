const LEFT_ODD = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const LEFT_EVEN = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const RIGHT = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export function ean13CheckDigit(firstTwelve: string): string {
  if (!/^\d{12}$/.test(firstTwelve)) throw new Error("EAN-13 requires twelve digits before the check digit");
  const sum = [...firstTwelve].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return String((10 - sum % 10) % 10);
}

export function isValidEan13(value: string): boolean {
  return /^\d{13}$/.test(value) && ean13CheckDigit(value.slice(0, 12)) === value[12];
}

/** The 95 data modules exclude the quiet zones added by the SVG renderer. */
export function encodeEan13Modules(value: string): boolean[] {
  if (!isValidEan13(value)) throw new Error("Invalid EAN-13 barcode");
  const parity = PARITY[Number(value[0])];
  const left = [...value.slice(1, 7)].map((digit, index) => (parity[index] === "L" ? LEFT_ODD : LEFT_EVEN)[Number(digit)]).join("");
  const right = [...value.slice(7)].map((digit) => RIGHT[Number(digit)]).join("");
  return [...`101${left}01010${right}101`].map((bit) => bit === "1");
}
