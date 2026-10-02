FROM node:22-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY angular.json tsconfig*.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend
WORKDIR /src
COPY global.json ./
COPY backend/Directory.Build.props backend/
COPY backend/OpenSpec.Api/OpenSpec.Api.csproj backend/OpenSpec.Api/
RUN dotnet restore backend/OpenSpec.Api/OpenSpec.Api.csproj
COPY backend/OpenSpec.Api backend/OpenSpec.Api
RUN dotnet publish backend/OpenSpec.Api -c Release --no-restore -o /publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV DASHBOARD_MODE=hosted
ENV PORT=4310
COPY --from=backend /publish ./
COPY --from=frontend /app/dist/openspec-dashboard/browser ./wwwroot
USER $APP_UID
EXPOSE 4310
ENTRYPOINT ["dotnet", "OpenSpec.Api.dll"]
