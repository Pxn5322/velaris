import { Module, Injectable, Controller, Get, Query } from '@nestjs/common';

@Injectable()
export class AnalyticsService {
  getOverview(tenantId?: string) {
    return {
      totalTickets: 128,
      deflectionRate: '42%',
      avgResolutionTimeMinutes: 14,
      aiResolutionRate: '68%',
      tenantId: tenantId || 'all',
    };
  }
}

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}
  @Get('overview') getOverview(@Query('tenantId') t?: string) {
    return this.service.getOverview(t);
  }
}

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
