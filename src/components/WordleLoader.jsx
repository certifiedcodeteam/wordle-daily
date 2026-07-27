const letters = ["D", "A", "I", "L", "Y"];

export default function WordleLoader() {
  return (
    <div className="wordle-loader" role="status" aria-label="Loading Wordle Daily">
      <div className="wordle-loader-tiles" aria-hidden="true">
        {letters.map((letter, index) => (
          <span
            key={letter}
            className="wordle-loader-tile"
            style={/** @type {import("react").CSSProperties} */ ({ "--loader-tile-index": index })}
          >
            {letter}
          </span>
        ))}
      </div>
    </div>
  );
}
