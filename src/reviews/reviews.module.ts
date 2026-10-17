import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { MediaModule } from '../media/media.module';
import { UploadsModule } from '../uploads/uploads.module';
import {
  ReviewsAdminController,
  ReviewsController,
} from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [UploadsModule, MediaModule, CustomersModule],
  controllers: [ReviewsController, ReviewsAdminController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
