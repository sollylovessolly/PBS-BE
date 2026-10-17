import { BadRequestException } from '@nestjs/common';
import { giftPackages } from './packages.catalogue';
type PricedItem = {
  variant: { product: { category: string } };
  quantity: number;
  unitPrice: number;
  packageId?: string;
  packageGroupId?: string;
  customization?: Record<string, unknown>;
};
/** Expand package components to single units so the package charge has exact cent arithmetic. */
export function expandPackageItems<
  T extends { quantity: number; packageId?: string; packageGroupId?: string },
>(items: T[]): T[] {
  return items.flatMap((item) => {
    if (!item.packageId && !item.packageGroupId) return [item];
    if (
      !item.packageId ||
      !item.packageGroupId ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 10
    )
      throw new BadRequestException('Invalid gift package item');
    return Array.from({ length: item.quantity }, () => ({
      ...item,
      quantity: 1,
    }));
  });
}
export function applyPackagePricing<T extends PricedItem>(items: T[]): boolean {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    if (!!item.packageId !== !!item.packageGroupId)
      throw new BadRequestException('Incomplete gift package selection');
    if (item.packageGroupId)
      groups.set(item.packageGroupId, [
        ...(groups.get(item.packageGroupId) ?? []),
        item,
      ]);
  }
  for (const group of groups.values()) {
    const p = giftPackages.find((p) => p.id === group[0].packageId);
    if (!p || group.some((i) => i.packageId !== p.id || i.quantity !== 1))
      throw new BadRequestException('Invalid gift package selection');
    const expected: Record<string, number> = {
      POLAROID: p.polaroids,
      PHONE_CASE: p.cases,
      PHOTOSTRIP: p.strips,
      VINTAGE_LETTER: 1,
    };
    const counts: Record<string, number> = {};
    for (const item of group) {
      const category = item.variant.product.category;
      counts[category] = (counts[category] ?? 0) + item.quantity;
      if (
        category === 'PHONE_CASE' &&
        item.customization?.package !== 'CASE_ONLY'
      )
        throw new BadRequestException(
          'Gift package phone cases must use Case Only',
        );
    }
    if (
      Object.keys(counts).some((c) => !(c in expected)) ||
      Object.entries(expected).some(([c, n]) => (counts[c] ?? 0) !== n)
    )
      throw new BadRequestException(
        'Gift package contents do not match the selected package',
      );
    group.forEach((item, index) => {
      item.unitPrice = index === 0 ? p.price : 0;
      item.customization = {
        ...item.customization,
        giftPackageId: p.id,
        giftPackageName: p.name,
        giftPackageGroupId: item.packageGroupId,
        premiumPackagingIncluded: true,
        ...(index === 0 ? { giftPackagePrice: p.price } : {}),
      };
    });
    if (p.mini) {
      const strip = group.find(
        (i) => i.variant.product.category === 'PHOTOSTRIP',
      )!;
      strip.customization = {
        ...strip.customization,
        bonusMiniPhotostrip: true,
        bonusNote: 'Include a free mini photostrip using this design.',
      };
    }
  }
  return groups.size > 0;
}
export function packagingCharge(
  selected: boolean | undefined,
  hasPackages: boolean,
) {
  return {
    premiumPackaging: !!selected || hasPackages,
    packagingFee: selected && !hasPackages ? 1500 : 0,
  };
}
