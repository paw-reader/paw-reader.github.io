
--- Guide for carousel-snap-highlights ---
Scroll-state container queries allow you to style elements based on their current scroll state, such as whether an element is "stuck" (via sticky positioning) or "snapped" (via scroll snapping). This enables carousel or gallery experiences where the active item can be visually distinguished without relying on JavaScript intersection observers or scroll event listeners.

### Core implementation

To highlight snapped items, you must establish a scroll-snap container, define the snap targets as scroll-state containers, and then query that state to style descendants.

#### 1. Establish the scroll snap container
The parent container must have `scroll-snap-type` enabled.

```html
<div class="carousel">
  <div class="carousel-item">
    <div class="card">Product 1 content</div>
  </div>
  <div class="carousel-item">
    <div class="card">Product 2 content</div>
  </div>
</div>
```

```css
.carousel {
  display: flex;
  overflow-x: auto;
  /* MANDATORY: Enable scroll snapping on the container */
  scroll-snap-type: x mandatory;
}
```

#### 2. Define snap targets as scroll-state containers
Each item in the carousel that should be tracked for snapping must be declared as a `scroll-state` container.

```css
.carousel-item {
  /* Define where the item snaps within the container */
  scroll-snap-align: center;
  
  /* MANDATORY: Establish this element as a scroll-state query container */
  container-type: scroll-state;
}
```

#### 3. Query the `snapped` state

Because container queries style **descendants**, you must apply the highlight styles to an element *inside* the snap target.  Because the scroll container is set to overflow on the x axis, use the `scroll-state(snapped: x)` query.

**MANDATORY**: Wrap the styles in ` @media (prefers-reduced-motion: no-preference)` to only show the effect to users who have not requested reduced motion. Depending on your use case, you may retain portions of the effect, but in this case, the cards flash from white to blue in a way that may cause problems for some users, so we disable it completely.

```css
/* Specify transition outside of queries so that it is applied regardless of state.  */
.card {
  transition:
    scale 0.4s cubic-bezier(0.25, 0.8, 0.25, 1),
    background-color 0.4s,
    color 0.4s,
    box-shadow 0.4s;
}
/* 
Only show the effect for users not requesting reduced motion. Disable completely, including the color change, as it causes a flash that may be problematic.
*/
@media (prefers-reduced-motion: no-preference) {
  /* Style the content when its parent .carousel-item is snapped on the x axis */
  @container scroll-state(snapped: x) {
    .card {
      background: #007bff;
      color: white;
      scale: 1.15;
      box-shadow: 0 10px 25px rgba(0, 123, 255, 0.3);
    }
  }
}

/* MANDATORY Copy-Paste Safety: Disable highlight scaling/flashing for motion sensitive users */
@media (prefers-reduced-motion: reduce) {
  .card {
    transition: none !important;
    scale: 1 !important;
  }
}
```

The `snapped` descriptor can query specific axes: `x`, `y`, `inline`, `block`, or `both`.


### Accessibility

**AVOID**: using `scroll-state` with interactive elements.

Visual highlights for snapped items can improve the UX, but the snapped item is not exposed to the accessibility tree. The visual theme applied to a snapped item should not convey that the element is active or focused, and a keyboard focus ring should be highly visible and distinct from the `snapped` highlight. If the snapped item is interactive, you must use other standard accessibility practices to make it accessible.  

Snapping occurs due to scrolling, which does not move keyboard focus. However, keyboard focus may cause the scroll container to move, causing a change in the snapped item, which may or may not be the focused item. This will likely be a source of confusion for users and is discouraged.

> [!NOTE]
> Detailed accessibility requirements for carousels (such as ARIA roles, slide attributes, and complex keyboard patterns) have been intentionally omitted from this guide. Carousel accessibility is highly nuanced and context-dependent; refer to established accessibility standards and perform thorough user testing for production environments.


## Fallback strategies

Container scroll-state queries has limited availability.
Supported by: Chrome 133 (Feb 2025) and Edge 133 (Feb 2025).
Unsupported in: Firefox and Safari.

For browsers that do not support scroll-state queries, you should provide a functional base experience where all items are legible, even without the "active" highlight.

#### Feature detection
You can use `@supports` to provide enhancements only to supported browsers:

```css
@supports (container-type: scroll-state) {
  /* Enhancement styles here */
}
```

#### JavaScript fallback

If the highlight is critical for the user experience, use `IntersectionObserver` to determine the snapped item. Adjust the observed area to a thin slice in the center of the carousel by providing a `rootMargin` with a negative inline value. For example, to consider an element to be intersecting if it is in the center 2% of the carousel, set the `rootMargin` to `"0px -49%"`.  

```javascript
// Optional: detect support and apply a JS-based fallback
if (!CSS.supports('container-type', 'scroll-state')) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      // Toggle a class based on intersection
      entry.target.classList.toggle('is-snapped', entry.isIntersecting);
    });
  }, {
    root: document.querySelector(".carousel"),
    // Carousel item intersects if any part of the carousel item is in the middle 2% of the carousel.
    rootMargin: "0px -49%"
  });

  document.querySelectorAll('.carousel-item').forEach(item => {
    observer.observe(item);
  });
}
```


--- Guide for carousel-slide-effects ---
# Build Carousel Slide Effects

Carousel slide effects are a great way to add visual interest to a carousel. As the user scrolls through the slides, each slide can animate as it enters, centers, and exits the scrollport. For example, the slides can fade in and out, rotate, or scale in size. This creates a dynamic and engaging user experience. Unlike simple entry/exit animations, this effect uses a single, continuous animation to control the slide's appearance across the entire scrollport.

## How to implement

Here’s how to create carousel slide effects:

1.  **Create a scroller:** This element will act as the container for your carousel slides. In this example it uses `overflow-x: scroll` to allow horizontal scrolling.

    ```html
    <ul class="scroller">
      <li class="entry">1</li>
      <li class="entry">2</li>
      <li class="entry">3</li>
      …
    </ul>
    ```

    ```css
    .scroller {
      overflow-x: scroll;
    }
    ```

2.  **Define the animation:** Create a CSS animation that defines the different states of your slides as they traverse the scrollport. You can define keyframes for any part of the animation. For example, you can define a state for when the slides are in the center of the scrollport by including a `50%` keyframe. In this example, the `scale` property makes the slides grow as they approach the center and shrink as they move away.

    ```css
    @keyframes animate {
      0% {
        scale: 0.5;
      }
      50% {
        scale: 1;
      }
      100% {
        scale: 0.5;
      }
    }
    ```

3.  **Apply the animation and `view-timeline`:** Attach the animation to the carousel slides and link it to a `view-timeline` that tracks the element as it scrolls through the container.

    ```css
    .scroller > * {
      animation: animate auto linear both;
      animation-timeline: view(inline);
    }
    ```

    By default, `view()` tracks the element on the `block` axis. If you need to track it on the `inline` axis, you can use `view(inline)`.

## Example code

This code animates the carousel items of a horizontal scroller on scroll using an **anonymous view-timeline**:

```css
@keyframes animate {
  0% {
    scale: 0.5;
  }

  50% {
    scale: 1;
  }

  100% {
    scale: 0.5;
  }
}

.scroller > * {
  /* Applies the animation using an `auto` duration */
  animation: animate auto linear both;
  /* Sets the animation timeline to use an anonymous view progress timeline, tracking the element's progress through the scroller on the inline axis */
  animation-timeline: view(inline);
}
```

This code animates the carousel items of a horizontal scroller on scroll using a **named view-timeline**:

```css
@keyframes animate {
  0% {
    scale: 0.5;
  }

  50% {
    scale: 1;
  }

  100% {
    scale: 0.5;
  }
}

/* This creates a named view-timeline on each carousel item. The timeline is used to drive the animation that is applied on the same element. */
.scroller > * {
  /* Applies the animation using an `auto` duration */
  animation: animate auto linear both;
  /* Defines a named view progress timeline, tracking the element's progress through the scroller on the inline axis */
  view-timeline: --item inline;
  /* Sets the animation timeline to use the named view progress timeline defined above */
  animation-timeline: --item;
}
```

## Best Practices

When using scroll-driven animations, it's important to follow a few best practices to ensure a smooth and accessible experience:

- **DO** include feature detection: Not all browsers support scroll-driven animations. Use `@supports ((animation-timeline: view()) and (animation-range: entry))` to check for support and provide a fallback for browsers that don't support it.
  - The `(animation-range: entry)` check **MUST** be included here, to filter out browsers with only partial support.
  - **DO NOT** use the `scroll-timeline-polyfill` package for the fallback strategy as it is not feature complete and has a lot of known issues.
  - If the animation is only considered to be decorative, opt for Progressive Enhancement and **DO NOT** provide a fallback.
- **DO** respect user preferences: Some users prefer to have less motion on the web. Use the `prefers-reduced-motion` media query to disable or reduce your animations for these users.
- **DO** try to animate only performant CSS properties: For the smoothest animations, stick to animating properties that can be handled by the browser's compositor thread, such as `transform` and `opacity`. Animating other properties like `width` or `height` can lead to performance issues.
- **DO** use the correct declaration order: When using the `animation` shorthand property, declare `animation-timeline` and `animation-range` *after* it to prevent the shorthand from resetting the timeline.

Prefer a named `view-timeline` when multiple DOM elements need to animate based on the same timeline, or when you need to animate children of the element that has the `view-timeline` defined on it. If the element that you animate is also the element that defines the `view-timeline`, you can use an anonymous view-timeline using `view()`.

When using the `view()` function to create a scroll-driven animation:

- **OPTIONAL** be explicit about the axis to track: When not targeting the default `block` axis (such as in a horizontal scroller), be explicit about which axis to track with `view(block)` or `view(inline)`.

When using the `view-timeline` property to create a scroll-driven animation:

- **DO** use a CSS `<dashed-ident>` for the name (e.g. `view-timeline: --my-custom-name`)
- **OPTIONAL** be explicit about the axis to track: When not targeting the default `block` axis (such as in a horizontal scroller), be explicit about which axis to track with `view-timeline-axis`.
- **DO** make sure the scope of the lookup works: When the element that is declaring the `view-timeline` is not a flat tree ancestor of the animated element, hoist up the visibility of the `view-timeline`’s name by using `timeline-scope` on a shared ancestor.

## Browser support and fallback strategies

Scroll-driven animations has limited availability.
Supported by: Chrome 115 (Jul 2023), Edge 115 (Jul 2023), and Safari 26 (Sep 2025).
Unsupported in: Firefox.. Therefore, a fallback strategy is typically required.

For browsers that do not support scroll-driven animations, you can use a fallback to recreate the visual effects. The fallbacks are typically built with either a scroll listener (for ScrollTimeline effects) or the IntersectionObserver API (for ViewTimeline effects).

In browsers with built-in support for scroll-driven animations, ALWAYS use the native CSS implementation as those are more performant.

Note that not every effect can be recreated using the fallbacks approach.

For this use-case specifically, the following script applies the fallback for browsers that do not support scroll-driven animations. It uses the Web Animations API (`Element.animate()`) to create a paused animation for each item in the carousel. It then listens to the `scroll` event on the scroller and updates the `currentTime` of each animation based on the item's scroll progress within the scroller.

```js
// Fallback for browsers that don't support scroll-driven animations
if (!CSS.supports('(animation-timeline: view()) and (animation-range: entry)')) {
  const scroller = document.querySelector('.scroller');
  const entries = document.querySelectorAll('.entry');

  // Create a map to store animations
  const animations = new Map();

  entries.forEach(entry => {
    const animation = entry.animate(
      {
        scale: ['0.5', '1', '0.5']
      },
      {
        duration: 1, // We'll control the time ourselves
        fill: 'both'
      }
    );
    animation.pause();
    animations.set(entry, animation);
  });

  // Update animations on scroll
  const tick = () => {
    const scrollerRect = scroller.getBoundingClientRect();

    entries.forEach(entry => {
      const animation = animations.get(entry);
      if (!animation) return;

      const entryRect = entry.getBoundingClientRect();
      const progress = (entryRect.left + entryRect.width / 2 - scrollerRect.left) / scrollerRect.width;

      animation.currentTime = progress;
    });
  };
    
  scroller.addEventListener('scroll', tick);
  tick();
}
```

