import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  MaxLength,
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsNotEmpty,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OrderSource } from '../../generated/prisma/enums';

class CustomerDto {
  @ApiProperty({
    example: 'Jane Doe',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    example: '08012345678',
  })
  @IsString()
  @Matches(/[0-9]{10,}/, { message: 'phone must be a valid phone number' })
  phone!: string;

  @ApiPropertyOptional({
    example: 'jane@example.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}

class DeliveryDto {
  @ApiProperty({
    example: 'Lagos',
  })
  @IsString()
  @IsNotEmpty()
  state!: string;

  @ApiProperty({
    example: '12 Marina Road, Victoria Island',
  })
  @IsString()
  @IsNotEmpty()
  address!: string;
}

class OrderItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  packageId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{1,80}$/)
  packageGroupId?: string;

  @ApiProperty({
    description: 'Stable product variant SKU',
    example: 'POLAROID-STANDARD',
  })
  @IsString()
  variantSku!: string;

  @ApiProperty({
    example: 2,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    description:
      'Product-dependent fulfillment data: Polaroid finalPngUrl/previewUrl, Photostrip finalPngUrl, Vintage Letter finalPdfUrl, or Phone Case package',
    example: {
      finalPngUrl: 'https://example.com/final.png',
      previewUrl: 'https://example.com/preview.png',
    },
  })
  @IsOptional()
  @IsObject()
  customization?: Record<string, unknown>;
}

class ShipmentSelectionDto {
  @ApiProperty({ description: 'Opaque token returned by Shipbubble Rates API' })
  @IsString()
  requestToken!: string;
  @ApiProperty() @IsString() serviceCode!: string;
  @ApiProperty() @IsString() courierId!: string;
}

export class CreateOrderDto {
  @ApiPropertyOptional({
    description:
      'Add premium protective packaging for NGN 1500; included at no extra charge with gift packages.',
  })
  @IsOptional()
  @IsBoolean()
  premiumPackaging?: boolean;

  @ApiPropertyOptional({
    description:
      'Stable client-generated idempotency key. Required for WEBSITE orders.',
    example: 'checkout_550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  checkoutKey?: string;

  @ApiPropertyOptional({ example: 'WELCOME10' })
  @IsOptional()
  @IsString()
  discountCode?: string;

  @ApiPropertyOptional({ type: ShipmentSelectionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShipmentSelectionDto)
  shipment?: ShipmentSelectionDto;

  @ApiProperty({
    type: CustomerDto,
  })
  @ValidateNested()
  @Type(() => CustomerDto)
  customer!: CustomerDto;

  @ApiProperty({
    type: DeliveryDto,
  })
  @ValidateNested()
  @Type(() => DeliveryDto)
  delivery!: DeliveryDto;

  @ApiProperty({
    enum: OrderSource,
    example: OrderSource.WEBSITE,
  })
  @IsEnum(OrderSource)
  source!: OrderSource;

  @ApiPropertyOptional({
    example: 'Please deliver before 5pm',
  })
  @IsOptional()
  @IsString()
  customerNote?: string;

  @ApiProperty({
    type: [OrderItemDto],
    example: [
      {
        variantSku: 'POLAROID-STANDARD',
        quantity: 2,
        customization: {
          finalPngUrl: 'https://storage.example/polaroids.png',
          previewUrl: 'https://storage.example/polaroids-preview.png',
        },
      },
      {
        variantSku: 'VINTAGE-AMBER-BURNT',
        quantity: 1,
        customization: {
          finalPdfUrl: 'https://storage.example/letter.pdf',
        },
      },
      {
        variantSku: 'PHONECASE-IPHONE-15-PRO',
        quantity: 1,
        customization: { package: 'WITH_POLAROID' },
      },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({
    each: true,
  })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}
