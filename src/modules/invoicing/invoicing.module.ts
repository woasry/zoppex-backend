import { Module } from '@nestjs/common';
import { InvoicingService } from './invoicing.service';

@Module({
  providers: [InvoicingService],
  exports: [InvoicingService],
})
export class InvoicingModule {}
