export const metadata = {
  title: 'ГОРИЗОНТ — Config Control Panel',
};

export default function HorizonConfigPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-100 mb-4">
        Контрольная панель конфигурации
      </h1>
      <div className="bg-gray-900 rounded-lg p-6">
        <p className="text-gray-400">
          UI компоненты будут добавлены в Спринте 5
        </p>
        <div className="mt-4 text-sm text-gray-500">
          API endpoints уже работают:
          <ul className="list-disc list-inside mt-2">
            <li>GET /api/horizon/config — получить конфиг</li>
            <li>PUT /api/horizon/config — обновить конфиг</li>
            <li>POST /api/horizon/config/preview — preview изменений</li>
            <li>GET /api/horizon/config/history — история изменений</li>
            <li>POST /api/horizon/config/rollback — откат</li>
            <li>POST /api/horizon/config/freeze — заморозка</li>
            <li>GET /api/horizon/health — статус системы</li>
          </ul>
        </div>
      </div>
    </div>
  );
}