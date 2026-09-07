import type { Label } from "../domain/label.js";

// Caret and tilde start commands, so any that arrive in address data are sent as hex escapes.
// Without this a delivery address could rewrite the label it is printed on.
function escape(value: string): string {
  return value.replace(/\^/g, "_5e").replace(/~/g, "_7e");
}

function field(x: number, y: number, font: number, value: string): string {
  return `^FO${String(x)},${String(y)}^A0N,${String(font)},${String(font)}^FD${escape(value)}^FS`;
}

export function toZpl(label: Label): string {
  const lines = [
    "^XA",
    "^CI28",
    field(20, 20, 40, label.reference),
    field(20, 70, 34, label.origin),
    field(420, 70, 34, label.serviceLevel.replace("_", " ")),
    `^FO20,120^A0N,96,96^FD${escape(label.sortCode)}^FS`,
    field(20, 240, 34, label.destinationHubCode),
    ...label.address.map((line, index) => field(20, 290 + index * 40, 32, line)),
    field(20, 480, 32, label.weight),
    ...(label.pieceOf === undefined ? [] : [field(220, 480, 32, label.pieceOf)]),
    ...(label.cod === undefined ? [] : [field(20, 530, 44, `COD ${label.cod}`)]),
    `^FO20,600^BY3^BCN,140,Y,N,N^FD${escape(label.barcode)}^FS`,
    "^XZ",
  ];
  return `${lines.join("\n")}\n`;
}
