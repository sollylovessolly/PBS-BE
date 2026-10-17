/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */
import { OrderSource, ProductCategory } from '../generated/prisma/client';
import { InventoryAvailabilityService } from '../inventory/inventory-availability.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryRatesService } from '../delivery-rates/delivery-rates.service';
import { PaymentsService } from '../payments/payments.service';
import { PhoneNumberService } from '../customers/phone-number.service';
import { OrderCustomizationService } from './order-customization.service';
import { OrdersService } from './orders.service';

describe('OrdersService order creation', () => {
  const variants = new Map([
    [
      'POLAROID-STANDARD',
      {
        id: 'polaroid',
        sku: 'POLAROID-STANDARD',
        name: 'Standard Polaroid',
        sellingPrice: 3500,
        outsourcedUnitCost: 0,
        isActive: true,
        product: {
          name: 'Polaroids',
          category: ProductCategory.POLAROID,
          isActive: true,
        },
      },
    ],
    [
      'VINTAGE-AMBER-BURNT',
      {
        id: 'letter',
        sku: 'VINTAGE-AMBER-BURNT',
        name: 'Amber — Burnt Edge',
        sellingPrice: 4000,
        outsourcedUnitCost: 500,
        isActive: true,
        product: {
          name: 'Vintage Letters',
          category: ProductCategory.VINTAGE_LETTER,
          isActive: true,
        },
      },
    ],
    [
      'PHONECASE-IPHONE-15-PRO',
      {
        id: 'phone',
        sku: 'PHONECASE-IPHONE-15-PRO',
        name: 'iPhone 15 Pro',
        sellingPrice: 5500,
        outsourcedUnitCost: 0,
        isActive: true,
        product: {
          name: 'Phone Cases',
          category: ProductCategory.PHONE_CASE,
          isActive: true,
        },
      },
    ],
  ]);

  it.each([false, true])(
    'creates an unpaid mixed order with premium packaging=%s using backend prices without deducting stock',
    async (premiumPackaging) => {
      const orderCreate = jest
        .fn()
        .mockResolvedValue({ id: 'order-1', status: 'PENDING' });
      const orderItemCreateMany = jest.fn().mockResolvedValue({ count: 3 });
      const historyCreate = jest.fn().mockResolvedValue({ id: 'history-1' });
      const finalOrder = {
        id: 'order-1',
        paymentStatus: 'UNPAID',
        subtotal: 20000,
        deliveryFee: 3800,
        totalAmount: 23800,
      };
      const tx = {
        customer: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'customer-1', email: null }),
          update: jest.fn().mockResolvedValue({ id: 'customer-1' }),
        },
        productVariant: {
          findUnique: jest.fn(({ where }: { where: { sku: string } }) =>
            Promise.resolve(variants.get(where.sku) ?? null),
          ),
        },
        order: {
          create: orderCreate,
          findUnique: jest.fn().mockResolvedValue(finalOrder),
        },
        orderItem: { createMany: orderItemCreateMany },
        orderStatusHistory: { create: historyCreate },
      };
      const prisma = {
        order: { findUnique: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
      } as unknown as PrismaService;
      const inventory = {
        assertOrderAvailability: jest.fn().mockResolvedValue([]),
        calculateUnitPrice: jest.fn(
          (
            price: number,
            category: ProductCategory,
            customization?: Record<string, unknown>,
          ) =>
            category === ProductCategory.PHONE_CASE &&
            customization?.package === 'WITH_POLAROID'
              ? price + 3500
              : price,
        ),
      } as unknown as InventoryAvailabilityService;
      const service = new OrdersService(
        prisma,
        inventory,
        new OrderCustomizationService(),
        {
          resolve: jest.fn().mockResolvedValue({ state: 'Lagos', fee: 3800 }),
        } as unknown as DeliveryRatesService,
        {} as PaymentsService,
        new PhoneNumberService(),
      );

      const upload = (purpose: string, name: string) =>
        `https://api.example/api/uploads/files/${Buffer.from(`production/${purpose}/${name}`).toString('base64url')}`;
      const result = await service.create({
        checkoutKey: 'checkout-unit-test-1',
        premiumPackaging,
        customer: {
          name: 'Jane Doe',
          phone: '08012345678',
          email: 'jane@example.com',
        },
        delivery: { state: 'Lagos', address: '12 Marina Road' },
        source: OrderSource.WEBSITE,
        items: [
          {
            variantSku: 'POLAROID-STANDARD',
            quantity: 2,
            customization: {
              finalPngUrl: upload('polaroid_final', 'final.png'),
              previewUrl: upload('polaroid_preview', 'preview.png'),
            },
          },
          {
            variantSku: 'VINTAGE-AMBER-BURNT',
            quantity: 1,
            customization: {
              finalPdfUrl: upload('vintage_letter_final', 'letter.pdf'),
            },
          },
          {
            variantSku: 'PHONECASE-IPHONE-15-PRO',
            quantity: 1,
            customization: {
              package: 'WITH_POLAROID',
              finalPngUrl: upload('polaroid_final', 'case-final.png'),
              previewUrl: upload('polaroid_preview', 'case-preview.png'),
            },
          },
        ],
      });

      expect(result).toBe(finalOrder);
      expect(orderCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subtotal: 20000,
          deliveryFee: 3800,
          totalAmount: 23800 + (premiumPackaging ? 1500 : 0),
          packagingFee: premiumPackaging ? 1500 : 0,
          premiumPackaging,
          revenueSnapshot: 20000 + (premiumPackaging ? 1500 : 0),
          deliveryState: 'Lagos',
        }),
      });
      expect(orderCreate.mock.calls[0][0].data).not.toHaveProperty(
        'paymentStatus',
      );
      expect(orderCreate.mock.calls[0][0].data).not.toHaveProperty(
        'inventoryDeductedAt',
      );
      expect(orderItemCreateMany.mock.calls[0][0].data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            variantId: 'polaroid',
            unitPriceSnapshot: 3500,
            totalPriceSnapshot: 7000,
          }),
          expect.objectContaining({
            variantId: 'letter',
            unitPriceSnapshot: 4000,
            totalPriceSnapshot: 4000,
          }),
          expect.objectContaining({
            variantId: 'phone',
            unitPriceSnapshot: 9000,
            totalPriceSnapshot: 9000,
          }),
        ]),
      );
      expect(inventory.assertOrderAvailability).toHaveBeenCalledTimes(1);
      expect(historyCreate).toHaveBeenCalledWith({
        data: { orderId: 'order-1', status: 'PENDING', note: 'Order created' },
      });

      await service.createManual({
        customer: { name: 'Jane Doe', phone: '08012345678' },
        delivery: { state: 'Lagos', address: '12 Marina Road' },
        source: OrderSource.WHATSAPP,
        adminNote: 'Received through WhatsApp',
        items: [{ variantSku: 'POLAROID-STANDARD', quantity: 2 }],
      });

      expect(orderCreate).toHaveBeenLastCalledWith({
        data: expect.objectContaining({
          source: OrderSource.WHATSAPP,
          subtotal: 7000,
          deliveryFee: 3800,
          totalAmount: 10800,
          adminNote: 'Received through WhatsApp',
        }),
      });
    },
  );
});
