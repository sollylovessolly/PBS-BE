import {
  applyPackagePricing,
  expandPackageItems,
  packagingCharge,
} from './package-pricing';
import { giftPackages } from './packages.catalogue';
const make = (
  category: string,
  quantity: number,
  packageId: string,
  group = 'one',
) => ({
  variant: { product: { category } },
  quantity,
  packageId,
  packageGroupId: group,
  unitPrice: 99999,
  customization: category === 'PHONE_CASE' ? { package: 'CASE_ONLY' } : {},
});
function contents(id: string) {
  const p = giftPackages.find((p) => p.id === id)!;
  return expandPackageItems([
    make('POLAROID', p.polaroids, id),
    make('PHONE_CASE', p.cases, id),
    make('VINTAGE_LETTER', 1, id),
    ...(p.strips ? [make('PHOTOSTRIP', p.strips, id)] : []),
  ]);
}
describe('gift package prices and protective packaging', () => {
  it.each(giftPackages)(
    'charges the fixed server price for $name and retains all physical components',
    (p) => {
      const items = contents(p.id);
      expect(applyPackagePricing(items)).toBe(true);
      expect(items.reduce((n, i) => n + i.quantity * i.unitPrice, 0)).toBe(
        p.price,
      );
      expect(items.reduce((n, i) => n + i.quantity, 0)).toBe(
        p.polaroids + p.cases + p.strips + 1,
      );
      expect(
        items.every(
          (i) => i.customization?.['premiumPackagingIncluded'] === true,
        ),
      ).toBe(true);
      if (p.mini)
        expect(
          items.find((i) => i.variant.product.category === 'PHOTOSTRIP')
            ?.customization?.['bonusMiniPhotostrip'],
        ).toBe(true);
    },
  );
  it('rejects missing, extra and mixed package components', () => {
    expect(() =>
      applyPackagePricing(contents('you-and-me').slice(1)),
    ).toThrow();
    expect(() =>
      applyPackagePricing([
        ...contents('you-and-me'),
        make('ALBUM', 1, 'you-and-me'),
      ]),
    ).toThrow();
    const mixed = contents('you-and-me');
    mixed[0].packageId = 'i-love-you';
    expect(() => applyPackagePricing(mixed)).toThrow();
  });
  it('rejects double-priced phone-case upgrades and invalid quantities', () => {
    const items = contents('you-and-me');
    items.find(
      (i) => i.variant.product.category === 'PHONE_CASE',
    )!.customization = { package: 'WITH_POLAROID' };
    expect(() => applyPackagePricing(items)).toThrow();
    expect(() =>
      expandPackageItems([make('POLAROID', 999999, 'you-and-me')]),
    ).toThrow();
    expect(() =>
      expandPackageItems([{ quantity: 1, packageGroupId: 'orphan' }]),
    ).toThrow();
  });
  it('keeps separate package groups at their own prices and ordinary products at their normal prices', () => {
    const first = contents('you-and-me');
    const second = contents('birthday-mini').map((i) => ({
      ...i,
      packageGroupId: 'two',
    }));
    const ordinary = {
      variant: { product: { category: 'ALBUM' } },
      quantity: 2,
      unitPrice: 5000,
    };
    const items = [...first, ...second, ordinary];
    applyPackagePricing(items);
    expect(items.reduce((n, i) => n + i.quantity * i.unitPrice, 0)).toBe(47000);
  });
  it('charges 1500 only for the optional upgrade and never again for gift packages', () => {
    expect(packagingCharge(false, false)).toEqual({
      premiumPackaging: false,
      packagingFee: 0,
    });
    expect(packagingCharge(true, false)).toEqual({
      premiumPackaging: true,
      packagingFee: 1500,
    });
    expect(packagingCharge(true, true)).toEqual({
      premiumPackaging: true,
      packagingFee: 0,
    });
    expect(packagingCharge(false, true)).toEqual({
      premiumPackaging: true,
      packagingFee: 0,
    });
  });
});
