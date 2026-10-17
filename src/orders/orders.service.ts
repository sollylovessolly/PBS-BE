import {
  applyPackagePricing,
  expandPackageItems,
  packagingCharge,
} from './package-pricing';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import {
  OrderSource,
  OrderStatus,
  PaymentStatus,
  Prisma,
  MovementReason,
} from '../generated/prisma/client';
import { DeliveryRatesService } from '../delivery-rates/delivery-rates.service';
import { InventoryAvailabilityService } from '../inventory/inventory-availability.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { PhoneNumberService } from '../customers/phone-number.service';
import { CreateManualOrderDto } from './dto/create-manual-order.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ManualPaymentDto } from './dto/manual-payment.dto';
import { OrderFiltersDto } from './dto/order-filters.dto';
import { UpdateAdminNoteDto } from './dto/update-admin-note.dto';
import { UpdateDeliveryCostDto } from './dto/update-delivery-cost.dto';
import { UpdateFulfillmentDto } from './dto/update-fulfillment.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateTrackingDto } from './dto/update-tracking.dto';
import { OrderCustomizationService } from './order-customization.service';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { DiscountsService } from '../discounts/discounts.service';
import { ShippingService } from '../shipping/shipping.service';
import { paginated, pagination } from '../common/dto/pagination.dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryAvailability: InventoryAvailabilityService,
    private readonly orderCustomization: OrderCustomizationService,
    private readonly deliveryRates: DeliveryRatesService,
    private readonly payments: PaymentsService,
    private readonly phoneNumbers: PhoneNumberService,
    @Optional() private readonly discounts?: DiscountsService,
    @Optional() private readonly shipping?: ShippingService,
  ) {}

  async create(createOrderDto: CreateOrderDto) {
    if (createOrderDto.source !== OrderSource.WEBSITE) {
      throw new BadRequestException(
        'Public order creation only accepts WEBSITE orders',
      );
    }
    if (!createOrderDto.customer.email?.trim()) {
      throw new BadRequestException(
        'Customer email is required for website checkout',
      );
    }
    if (!createOrderDto.customer.name.trim())
      throw new BadRequestException('Customer name is required');
    if (!createOrderDto.delivery.address.trim())
      throw new BadRequestException('Delivery address is required');
    if (!createOrderDto.checkoutKey?.trim())
      throw new BadRequestException(
        'checkoutKey is required for retry-safe website checkout',
      );

    const existing = await this.prisma.order.findUnique({
      where: { checkoutKey: createOrderDto.checkoutKey.trim() },
    });
    if (existing) return this.getCheckoutResponse(existing.id);
    try {
      return await this.createOrder(createOrderDto, true);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.order.findUnique({
          where: { checkoutKey: createOrderDto.checkoutKey.trim() },
        });
        if (raced) return this.getCheckoutResponse(raced.id);
      }
      throw error;
    }
  }

  async createManual(createOrderDto: CreateManualOrderDto) {
    return this.createOrder(createOrderDto, false, createOrderDto.adminNote);
  }

  private async createOrder(
    createOrderDto: CreateOrderDto,
    requireFulfillment: boolean,
    adminNote?: string,
  ) {
    if (createOrderDto.shipment) {
      if (!this.shipping)
        throw new BadRequestException('Shipping service is unavailable');
      if (!createOrderDto.customer.email)
        throw new BadRequestException(
          'Customer email is required for courier selection',
        );
      await this.shipping.validateSelection({
        name: createOrderDto.customer.name,
        email: createOrderDto.customer.email,
        phone: createOrderDto.customer.phone,
        address: createOrderDto.delivery.address,
        state: createOrderDto.delivery.state,
        items: createOrderDto.items.map((item) => ({
          variantSku: item.variantSku,
          quantity: item.quantity,
        })),
        requestToken: createOrderDto.shipment.requestToken,
        serviceCode: createOrderDto.shipment.serviceCode,
        courierId: createOrderDto.shipment.courierId,
      });
    }
    return this.prisma.$transaction(
      async (tx) => {
        const customer = await this.findOrCreateCustomer(
          tx,
          createOrderDto.customer,
        );

        const variants = await Promise.all(
          expandPackageItems(createOrderDto.items).map(async (item) => {
            const variant = await tx.productVariant.findUnique({
              where: {
                sku: item.variantSku,
              },
              include: {
                product: true,
              },
            });

            if (!variant || !variant.isActive || !variant.product.isActive) {
              throw new NotFoundException(
                `Variant with SKU "${item.variantSku}" was not found`,
              );
            }

            return {
              variant,
              quantity: item.quantity,
              packageId: item.packageId,
              packageGroupId: item.packageGroupId,
              customization: this.orderCustomization.normalize(
                variant.product.category,
                item.customization,
                requireFulfillment,
              ),
            };
          }),
        );

        const pricedItems = variants.map((item) => ({
          ...item,
          unitPrice: this.inventoryAvailability.calculateUnitPrice(
            Number(item.variant.sellingPrice),
            item.variant.product.category,
            item.customization,
          ),
        }));

        const hasPackages = applyPackagePricing(pricedItems);
        const { premiumPackaging, packagingFee } = packagingCharge(
          createOrderDto.premiumPackaging,
          hasPackages,
        );
        const subtotal = pricedItems.reduce(
          (total, item) => total + item.unitPrice * item.quantity,
          0,
        );

        const deliveryRate = await this.deliveryRates.resolve(
          createOrderDto.delivery.state,
          tx,
        );
        const deliveryFee = Number(deliveryRate.fee);
        const appliedDiscount = this.discounts
          ? await this.discounts.calculate(
              createOrderDto.discountCode,
              subtotal,
              tx,
            )
          : { amount: 0, code: null };
        const discount = appliedDiscount.amount;
        const totalAmount = subtotal + packagingFee + deliveryFee - discount;

        /* Validate all physical requirements without deducting them. */
        await this.inventoryAvailability.assertOrderAvailability(
          variants.map((item) => ({
            variantId: item.variant.id,
            variantSku: item.variant.sku,
            productCategory: item.variant.product.category,
            quantity: item.quantity,
            customization: item.customization,
          })),
          tx,
        );

        const outsourcedCost = variants.reduce(
          (total, item) =>
            total + Number(item.variant.outsourcedUnitCost) * item.quantity,
          0,
        );

        const order = await tx.order.create({
          data: {
            orderNumber: this.generateOrderNumber(),
            trackingToken: randomBytes(32).toString('base64url'),
            checkoutKey: createOrderDto.checkoutKey?.trim(),
            checkoutToken: randomBytes(32).toString('base64url'),

            customerId: customer.id,
            source: createOrderDto.source,

            subtotal,
            premiumPackaging,
            packagingFee,
            deliveryFee,
            discount,
            discountCode: appliedDiscount.code,
            totalAmount,

            deliveryState: deliveryRate.state,

            deliveryAddress: createOrderDto.delivery.address,

            customerNote: createOrderDto.customerNote,
            adminNote,
            shipmentRequestToken: createOrderDto.shipment?.requestToken,
            shipmentServiceCode: createOrderDto.shipment?.serviceCode,
            shipmentCourierId: createOrderDto.shipment?.courierId,

            revenueSnapshot: subtotal + packagingFee,

            outsourceCostSnapshot: outsourcedCost,
          },
        });

        await tx.orderItem.createMany({
          data: pricedItems.map((item) => ({
            orderId: order.id,
            variantId: item.variant.id,
            quantity: item.quantity,

            unitPriceSnapshot: item.unitPrice,

            totalPriceSnapshot: item.unitPrice * item.quantity,

            outsourcedCostSnapshot:
              Number(item.variant.outsourcedUnitCost) * item.quantity,

            materialCostSnapshot: 0,

            customization: item.customization as
              Prisma.InputJsonValue | undefined,
          })),
        });

        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            status: order.status,
            note: 'Order created',
          },
        });

        return tx.order.findUnique({
          where: {
            id: order.id,
          },
          select: {
            id: true,
            orderNumber: true,
            source: true,
            paymentStatus: true,
            status: true,
            premiumPackaging: true,
            packagingFee: true,
            subtotal: true,
            deliveryFee: true,
            discount: true,
            totalAmount: true,
            deliveryState: true,
            deliveryAddress: true,
            customerNote: true,
            createdAt: true,
            checkoutToken: true,
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
              },
            },
            items: {
              select: {
                id: true,
                quantity: true,
                unitPriceSnapshot: true,
                totalPriceSnapshot: true,
                customization: true,
                variant: {
                  select: {
                    name: true,
                    sku: true,
                    product: {
                      select: {
                        name: true,
                        category: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });
      },
      {
        maxWait: 15_000,
        timeout: 30_000,
      },
    );
  }

  async findAll(filters: OrderFiltersDto = {}) {
    const search = filters.search?.trim();
    const where: Prisma.OrderWhereInput = {
      status: filters.status,
      paymentStatus: filters.paymentStatus,
      source: filters.source,
      ...(filters.from || filters.to
        ? { createdAt: { gte: filters.from, lte: filters.to } }
        : {}),
      ...(search
        ? {
            OR: [
              {
                orderNumber: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
              {
                customer: {
                  name: { contains: search, mode: 'insensitive' as const },
                },
              },
              { customer: { phone: { contains: search } } },
            ],
          }
        : {}),
    };
    const { page, limit, skip, take } = pagination(filters);
    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          customer: true,

          items: {
            include: {
              variant: {
                include: {
                  product: true,
                },
              },
            },
          },
        },

        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take,
      }),
      this.prisma.order.count({ where }),
    ]);
    return paginated(data, total, page, limit);
  }

  async getCheckoutByToken(token: string) {
    const order = await this.prisma.order.findUnique({
      where: { checkoutToken: token },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        premiumPackaging: true,
        packagingFee: true,
        subtotal: true,
        deliveryFee: true,
        discount: true,
        totalAmount: true,
        deliveryState: true,
        checkoutToken: true,
        createdAt: true,
        items: {
          select: {
            quantity: true,
            unitPriceSnapshot: true,
            totalPriceSnapshot: true,
            variant: {
              select: {
                name: true,
                sku: true,
                product: { select: { name: true, category: true } },
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Checkout was not found');
    return order;
  }

  private getCheckoutResponse(id: string) {
    return this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        orderNumber: true,
        source: true,
        paymentStatus: true,
        status: true,
        premiumPackaging: true,
        packagingFee: true,
        subtotal: true,
        deliveryFee: true,
        discount: true,
        totalAmount: true,
        deliveryState: true,
        deliveryAddress: true,
        customerNote: true,
        checkoutToken: true,
        createdAt: true,
        customer: {
          select: { id: true, name: true, phone: true, email: true },
        },
        items: {
          select: {
            id: true,
            quantity: true,
            unitPriceSnapshot: true,
            totalPriceSnapshot: true,
            customization: true,
            variant: {
              select: {
                name: true,
                sku: true,
                product: { select: { name: true, category: true } },
              },
            },
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: {
        id,
      },

      include: {
        customer: true,

        items: {
          include: {
            variant: {
              include: {
                product: true,
              },
            },
          },
        },

        payments: true,

        stockMovements: {
          include: {
            resource: true,
          },
        },

        statusHistory: {
          orderBy: {
            changedAt: 'desc',
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID "${id}" was not found`);
    }

    return order;
  }

  async updateStatus(id: string, dto: UpdateOrderStatusDto) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order)
        throw new NotFoundException(`Order with ID "${id}" was not found`);

      this.assertStatusTransition(order.status, dto.status);
      const updated = await tx.order.update({
        where: { id },
        data: { status: dto.status },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          status: dto.status,
          note: dto.note ?? `Status changed to ${dto.status}`,
        },
      });
      return updated;
    });
  }

  async updateAdminNote(id: string, dto: UpdateAdminNoteDto) {
    await this.ensureOrder(id);
    return this.prisma.order.update({
      where: { id },
      data: { adminNote: dto.adminNote },
    });
  }

  async updateTracking(id: string, dto: UpdateTrackingDto) {
    await this.ensureOrder(id);
    return this.prisma.order.update({
      where: { id },
      data: { trackingLink: dto.trackingLink },
    });
  }

  async updateDeliveryCost(id: string, dto: UpdateDeliveryCostDto) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order)
        throw new NotFoundException(`Order with ID "${id}" was not found`);

      const paid = order.paymentStatus === PaymentStatus.PAID;
      const grossProfit =
        Number(order.revenueSnapshot) -
        Number(order.materialCostSnapshot) -
        Number(order.packagingCostSnapshot) -
        Number(order.outsourceCostSnapshot) -
        dto.actualDeliveryCost;

      return tx.order.update({
        where: { id },
        data: {
          actualDeliveryCost: dto.actualDeliveryCost,
          ...(paid
            ? {
                deliveryCostSnapshot: dto.actualDeliveryCost,
                grossProfitSnapshot: grossProfit,
              }
            : {}),
        },
      });
    });
  }

  async updateFulfillment(
    orderId: string,
    itemId: string,
    dto: UpdateFulfillmentDto,
  ) {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
      include: { variant: { include: { product: true } } },
    });
    if (!item) {
      throw new NotFoundException(
        `Order item with ID "${itemId}" was not found`,
      );
    }
    const customization = this.orderCustomization.normalize(
      item.variant.product.category,
      dto.customization,
      true,
    );
    return this.prisma.orderItem.update({
      where: { id: itemId },
      data: {
        customization: {
          ...Object.fromEntries(
            Object.entries(
              (item.customization ?? {}) as Record<string, unknown>,
            ).filter(([key]) =>
              [
                'giftPackageId',
                'giftPackageName',
                'giftPackageGroupId',
                'giftPackagePrice',
                'premiumPackagingIncluded',
                'bonusMiniPhotostrip',
                'bonusNote',
              ].includes(key),
            ),
          ),
          ...customization,
        } as Prisma.InputJsonValue,
      },
    });
  }

  recordManualPayment(id: string, dto: ManualPaymentDto) {
    return this.payments.recordManualPayment({
      orderId: id,
      method: dto.method,
      reference: dto.reference,
    });
  }

  retryBlockedFulfillment(id: string) {
    return this.payments.retryBlockedFulfillment(id);
  }

  retryShipment(id: string) {
    if (!this.shipping)
      throw new BadRequestException('Shipping service is unavailable');
    return this.shipping.retry(id);
  }

  async cancel(id: string, dto: CancelOrderDto) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`;
        const order = await tx.order.findUnique({ where: { id } });
        if (!order)
          throw new NotFoundException(`Order with ID "${id}" was not found`);
        if (order.status === OrderStatus.CANCELLED) {
          throw new BadRequestException('Order is already CANCELLED');
        }

        const restoreInventory =
          order.paymentStatus === PaymentStatus.PAID && dto.restoreInventory;
        if (restoreInventory) {
          if (order.inventoryRestoredAt)
            throw new BadRequestException(
              'Order inventory was already restored',
            );
          const usage = await tx.resourceMovement.findMany({
            where: {
              orderId: id,
              reason: MovementReason.ORDER_USAGE,
              quantity: { lt: 0 },
            },
          });
          for (const movement of usage) {
            const quantity = new Prisma.Decimal(movement.quantity).abs();
            await tx.resource.update({
              where: { id: movement.resourceId },
              data: { currentStock: { increment: quantity } },
            });
            await tx.resourceMovement.create({
              data: {
                resourceId: movement.resourceId,
                orderId: id,
                quantity,
                unitCost: movement.unitCost,
                reason: MovementReason.RETURN,
                note: `Cancellation return: ${dto.reason}`,
              },
            });
          }
        }

        const cancelledAt = new Date();
        const updated = await tx.order.update({
          where: { id },
          data: {
            status: OrderStatus.CANCELLED,
            ...(restoreInventory ? { inventoryRestoredAt: cancelledAt } : {}),
          },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId: id,
            status: OrderStatus.CANCELLED,
            note: dto.reason,
          },
        });
        return updated;
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
  }

  private assertStatusTransition(current: OrderStatus, next: OrderStatus) {
    if (current === next) {
      throw new BadRequestException(`Order is already ${next}`);
    }
    if (
      current === OrderStatus.DELIVERED ||
      current === OrderStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot change a terminal ${current} order`,
      );
    }
  }

  private async ensureOrder(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order)
      throw new NotFoundException(`Order with ID "${id}" was not found`);
    return order;
  }

  private async findOrCreateCustomer(
    tx: Prisma.TransactionClient,
    customer: CreateOrderDto['customer'],
  ) {
    const existingCustomer = await tx.customer.findFirst({
      where: {
        phone: { in: this.phoneNumbers.lookupCandidates(customer.phone) },
      },
    });

    if (existingCustomer) {
      return tx.customer.update({
        where: {
          id: existingCustomer.id,
        },

        data: {
          name: customer.name,
          isArchived: false,

          email: customer.email ?? existingCustomer.email,
        },
      });
    }

    return tx.customer.create({
      data: {
        name: customer.name,
        phone: this.phoneNumbers.normalizeNigerian(customer.phone),
        email: customer.email,
      },
    });
  }

  private generateOrderNumber() {
    const timestamp = Date.now();

    const random = Math.floor(Math.random() * 900) + 100;

    return `PBS-${timestamp}-${random}`;
  }
}
