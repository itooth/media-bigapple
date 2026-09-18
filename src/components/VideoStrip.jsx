export default function VideoStrip({ videos, label }) {
  if (!videos?.length) return null;
  return (
    <div className="video-strip" aria-label={label}>
      {videos.map((video) => (
        <figure className="video-card" key={video.id}>
          <video controls preload="metadata" playsInline>
            <source src={video.src} />
          </video>
          <figcaption>{video.caption}</figcaption>
        </figure>
      ))}
    </div>
  );
}
