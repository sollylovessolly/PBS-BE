import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { VariantsModule } from './variants/variants.module';
import { ResourcesModule } from './resources/resources.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrdersModule } from './orders/orders.module';
import { ResourceRulesModule } from './resource-rules/resource-rules.module';
import { PaymentsModule } from './payments/payments.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchasesModule } from './purchases/purchases.module';
import { DeliveryRatesModule } from './delivery-rates/delivery-rates.module';
import { TrackingModule } from './tracking/tracking.module';
import { UploadsModule } from './uploads/uploads.module';
import { ExpensesModule } from './expenses/expenses.module';
import { AuthModule } from './auth/auth.module';
import { OwnerWithdrawalsModule } from './owner-withdrawals/owner-withdrawals.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CustomersModule } from './customers/customers.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SecurityModule } from './security/security.module';
import { validateEnvironment } from './config/env.validation';
import { DiscountsModule } from './discounts/discounts.module';
import { ShippingModule } from './shipping/shipping.module';
import { GalleryModule } from './gallery/gallery.module';
import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
    ProductsModule,
    VariantsModule,
    ResourcesModule,
    InventoryModule,
    OrdersModule,
    ResourceRulesModule,
    PaymentsModule,
    SuppliersModule,
    PurchasesModule,
    DeliveryRatesModule,
    TrackingModule,
    UploadsModule,
    ExpensesModule,
    AuthModule,
    OwnerWithdrawalsModule,
    DashboardModule,
    CustomersModule,
    HealthModule,
    NotificationsModule,
    SecurityModule,
    DiscountsModule,
    ShippingModule,
    GalleryModule,
    ReviewsModule,
  ],

  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
