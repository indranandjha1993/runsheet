const CURRENCY_CODE = /^[A-Z]{3}$/;

export interface Money {
  readonly minorUnits: number;
  readonly currency: string;
  plus(other: Money): Money;
  minus(other: Money): Money;
  equals(other: Money): boolean;
  isGreaterThan(other: Money): boolean;
  toString(): string;
}

function sameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new Error(`cannot combine ${left.currency} and ${right.currency}`);
  }
}

export function money(minorUnits: number, currency: string): Money {
  if (!Number.isInteger(minorUnits)) {
    throw new Error("amount must be whole minor units");
  }
  if (!CURRENCY_CODE.test(currency)) {
    throw new Error("currency must be a three-letter code");
  }

  const self: Money = {
    minorUnits,
    currency,
    plus(other) {
      sameCurrency(self, other);
      return money(minorUnits + other.minorUnits, currency);
    },
    minus(other) {
      sameCurrency(self, other);
      return money(minorUnits - other.minorUnits, currency);
    },
    equals(other) {
      return other.currency === currency && other.minorUnits === minorUnits;
    },
    isGreaterThan(other) {
      sameCurrency(self, other);
      return minorUnits > other.minorUnits;
    },
    toString() {
      return `${(minorUnits / 100).toFixed(2)} ${currency}`;
    },
  };
  return self;
}
