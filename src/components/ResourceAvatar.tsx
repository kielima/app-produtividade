import { resourceInitial, resourcePhotoSrc } from '../lib/resources';
import type { Resource } from '../types';

/**
 * Bolinha com a foto (ou a inicial) de um recurso. `size` em px.
 */
export function ResourceAvatar({
  resource,
  size = 22,
  title,
}: {
  resource: Pick<Resource, 'nome' | 'foto'>;
  size?: number;
  title?: string;
}) {
  const src = resourcePhotoSrc(resource.foto);
  const label = title ?? resource.nome;
  return (
    <span
      className="resource-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      title={label}
      aria-label={label}
      role="img"
    >
      {src ? <img src={src} alt="" draggable={false} /> : resourceInitial(resource.nome)}
    </span>
  );
}
