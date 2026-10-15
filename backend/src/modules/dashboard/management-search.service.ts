import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ManagementSearchService {
  constructor(private readonly prisma:PrismaService) {}
  async search(q:string){
    const keyword=q.trim();if(keyword.length<2)return [];
    const text={contains:keyword,mode:'insensitive' as const};
    const [rooms,tenants,contracts,requests]=await Promise.all([
      this.prisma.room.findMany({where:{OR:[{roomNumber:text},{building:{name:text}}]},take:5,orderBy:{createdAt:'desc'},select:{id:true,roomNumber:true,status:true,building:{select:{name:true}}}}),
      this.prisma.tenant.findMany({where:{OR:[{name:text},{phone:{contains:keyword}}]},take:5,orderBy:{createdAt:'desc'},select:{id:true,name:true,phone:true}}),
      this.prisma.contract.findMany({where:{OR:[{contractNumber:text},{tenant:{name:text}},{room:{roomNumber:text}}]},take:5,orderBy:{createdAt:'desc'},select:{id:true,contractNumber:true,status:true,tenant:{select:{name:true}},room:{select:{roomNumber:true}}}}),
      this.prisma.maintenanceRequest.findMany({where:{OR:[{title:text},{room:{roomNumber:text}},{tenant:{name:text}}]},take:5,orderBy:{createdAt:'desc'},select:{id:true,title:true,status:true,room:{select:{roomNumber:true}}}}),
    ]);
    return [
      ...rooms.map(row=>({kind:'rooms',id:row.id,title:row.roomNumber,subtitle:row.building.name,status:row.status})),
      ...tenants.map(row=>({kind:'tenants',id:row.id,title:row.name,subtitle:row.phone})),
      ...contracts.map(row=>({kind:'contracts',id:row.id,title:row.contractNumber,subtitle:`${row.tenant.name} · ${row.room.roomNumber}`,status:row.status})),
      ...requests.map(row=>({kind:'maintenance',id:row.id,title:row.title,subtitle:row.room.roomNumber,status:row.status})),
    ];
  }
}
