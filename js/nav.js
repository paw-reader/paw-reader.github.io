import { PROXY_URL, state } from "./state.js";
import { buildCreatorCard } from "./creators.js";
import { resetFeed, fetchPosts } from "./feed.js";

export const welcomeScreen = document.getElementById("welcome-screen");
export const creatorsView = document.getElementById("creators-view");
export const feedView = document.getElementById("feed-view");
export const nav = document.getElementById("nav");
export const navHome = document.getElementById("nav-home");
export const navBack = document.getElementById("nav-back");
export const navInfo = document.getElementById("nav-info");
export const navSettings = document.getElementById("nav-settings");
export const settingsMenu = document.getElementById("settings-menu");
export const siteSelector = document.getElementById("site-selector");

let navLastVisibleTime = 0;

export function isNavInteractive() {
  if (!nav) return false;
  if (nav.classList.contains("hidden")) return false;
  if (nav.classList.contains("auto-hide") && !nav.classList.contains("visible")) return false;
  if (nav.classList.contains("auto-hide") && Date.now() - navLastVisibleTime < 400) return false;
  return true;
}

export function closeAllPostInfo() {
  const expanded = document.querySelectorAll(".post-info.expanded");
  if (expanded.length > 0) {
    expanded.forEach((el) => el.classList.remove("expanded"));
    updateNavVisibility();
  }
}

window.lastMouseY = window.innerHeight;

export function updateNavVisibility(mouseY = window.lastMouseY) {
  if (!nav || !nav.classList.contains("auto-hide")) return;
  const anyInfoExpanded = !!document.querySelector(".post-info.expanded");
  const dropdownOpen =
    !!document.getElementById("linked-accounts-dropdown") || !!document.getElementById("cum-posts-dropdown");
  const isVisible = anyInfoExpanded || dropdownOpen || mouseY < 80 || state.navManualVisible;
  if (isVisible) {
    if (!nav.classList.contains("visible")) {
      navLastVisibleTime = Date.now();
    }
    nav.classList.add("visible");
    document.body.classList.add("nav-visible");
  } else {
    nav.classList.remove("visible");
    document.body.classList.remove("nav-visible");
  }
}

export function updateSiteSpecificUI() {
  const contentFilter = document.getElementById("creator-content-filter");
  if (contentFilter) {
    if (state.currentSite === "cum") {
      contentFilter.style.display = "";
      contentFilter.value = "content";
    } else {
      contentFilter.style.display = "none";
      contentFilter.value = "all";
    }
  }

  const genderFilter = document.getElementById("creator-gender-filter");
  if (genderFilter) {
    if (state.currentSite === "cum") {
      genderFilter.style.display = "";
      genderFilter.value = "all";
    } else {
      genderFilter.style.display = "none";
      genderFilter.value = "all";
    }
  }

  const sortSelect = document.getElementById("creator-sort");
  if (sortSelect) {
    const prevVal = sortSelect.value;
    if (state.currentSite === "cum") {
      sortSelect.innerHTML = `
        <option value="popularity">Popularity</option>
        <option value="indexed">Date indexed</option>
        <option value="updated">Date updated</option>
        <option value="alphabetical">Alphabetical</option>
        <option value="service">By service</option>
        <option value="dms">DM count</option>
        <option value="posts">Post count</option>
      `;
      sortSelect.value = ["popularity", "indexed", "updated", "alphabetical", "service", "dms", "posts"].includes(
        prevVal
      )
        ? prevVal
        : "popularity";
    } else {
      sortSelect.innerHTML = `
        <option value="popularity">Popularity</option>
        <option value="indexed">Date Indexed</option>
        <option value="updated">Date Updated</option>
        <option value="alphabetical">Alphabetical Order</option>
        <option value="service">Service</option>
      `;
      sortSelect.value = ["popularity", "indexed", "updated", "alphabetical", "service"].includes(prevVal)
        ? prevVal
        : "popularity";
    }
  }

  const sortDirBtn = document.getElementById("creator-sort-dir");
  if (sortDirBtn) {
    sortDirBtn.innerHTML =
      state.creatorSortDir === "asc"
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>';
  }

  const creatorsTitle = document.getElementById("creators-title");
  if (creatorsTitle) {
    const displayNames = {
      pawchive: "Pawchive",
      kemono: "Kemono",
      cum: "Coomer",
    };
    creatorsTitle.textContent = `${displayNames[state.currentSite] || "Selected"} creators`;
  }
}

export function updateNavTabs(creator) {
  const navTabs = document.getElementById("nav-tabs");
  if (!navTabs) return;
  navTabs.innerHTML = "";

  if (!creator) return;

  let tabs = [];
  if (state.currentSite === "kemono" || state.currentSite === "pawchive") {
    tabs = ["Posts", "Announcements", "Fancards", "Tags", "DMs", "Linked Accounts", "Similar Artists"];
  } else if (state.currentSite === "cum") {
    const isFansly =
      (creator.service || "").toLowerCase() === "fansly" ||
      (creator.allPlatforms && creator.allPlatforms.some((p) => (p.service || "").toLowerCase() === "fansly"));
    if (isFansly) {
      tabs = ["Posts", "Fancards", "DMs", "Linked Accounts", "Similar Creators"];
    } else {
      tabs = ["Posts", "DMs", "Linked Accounts", "Similar Creators"];
    }
  }

  tabs = tabs.filter((tab) => {
    if (tab === "DMs" && (creator.dmCount === 0 || creator.dmCount === null)) return false;
    if (tab === "Posts" && (creator.postCount === 0 || creator.postCount === null)) return false;
    if (tab === "Linked Accounts" && state.currentSite === "cum" && (!creator.allPlatforms || creator.allPlatforms.length <= 1)) return false;
    return true;
  });

  const feed = document.getElementById("feed");

  tabs.forEach((tab, index) => {
    const btn = document.createElement("button");
    btn.style.flexShrink = "0";

    let postCategories = [];
    if (state.currentSite === "cum" && tab === "Posts") {
      if (creator.imageCount > 0) {
        postCategories.push({
          key: "photos",
          label:
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> Photos',
        });
      }
      if (creator.videoCount > 0) {
        postCategories.push({
          key: "videos",
          label:
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px;"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg> Videos',
        });
      }
      if (creator.audioCount > 0) {
        postCategories.push({
          key: "audio",
          label:
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px;"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg> Audio',
        });
      }
      if (creator.postCount > 0) {
        postCategories.push({
          key: "text",
          label:
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> Text',
        });
      }
    }

    if (tab === "Linked Accounts") {
      const srv = (creator.service || "").toLowerCase();
      btn.innerHTML = `<img src="icons/${srv}.svg" style="width: 14px; height: 14px; object-fit: contain;" onerror="this.style.display='none'"> &middot; Linked Accounts`;
      
      if ((state.currentSite === "kemono" || state.currentSite === "pawchive") && (!creator.allPlatforms || creator.allPlatforms.length <= 1)) {
        btn.style.display = "none";
      } else {
        btn.style.display = "flex";
      }
      
      btn.style.alignItems = "center";
      btn.style.gap = "6px";
    } else {
      btn.textContent = state.currentSite === "cum" && tab === "Posts" && postCategories.length > 0 ? "Posts ▾" : tab;
    }
    if (index === 0) btn.style.background = "rgba(0, 123, 255, 0.6)";

    btn.addEventListener("click", (e) => {
      if (!isNavInteractive()) return;

      if (state.currentSite === "cum" && tab === "Posts" && postCategories.length > 0) {
        const existingDropdown = document.getElementById("cum-posts-dropdown");
        if (existingDropdown) {
          existingDropdown.remove();
          return;
        }

        const dropdown = document.createElement("div");
        dropdown.id = "cum-posts-dropdown";

        const btnRect = btn.getBoundingClientRect();
        dropdown.style.cssText = `
          position: fixed;
          top: ${btnRect.bottom + 6}px;
          left: ${btnRect.left + btnRect.width / 2}px;
          transform: translateX(-50%);
          background: rgba(0,0,0,0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 14px;
          padding: 8px;
          display: flex; flex-direction: column; gap: 6px;
          min-width: 170px;
          z-index: 1100;
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        `;

        postCategories.forEach((cat) => {
          const row = document.createElement("label");
          row.style.cssText = `
            display: flex; align-items: center; gap: 10px;
            padding: 8px 12px; border-radius: 10px;
            background: rgba(255,255,255,0.08);
            color: #fff; font-size: 0.9rem;
            cursor: pointer; user-select: none;
            transition: background 0.15s;
          `;
          row.onmouseenter = () => (row.style.background = "rgba(255,255,255,0.18)");
          row.onmouseleave = () => (row.style.background = "rgba(255,255,255,0.08)");

          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.value = cat.key;
          cb.checked = state.cumSelectedTypes.includes(cat.key);
          cb.style.cssText = "width: 16px; height: 16px; cursor: pointer; accent-color: #007bff;";

          const nameSpan = document.createElement("span");
          nameSpan.innerHTML = cat.label;

          row.appendChild(cb);
          row.appendChild(nameSpan);

          cb.addEventListener("change", () => {
            const checked = Array.from(dropdown.querySelectorAll("input:checked")).map((i) => i.value);
            if (checked.length === 0) {
              cb.checked = true;
              return;
            }
            state.cumSelectedTypes = checked;

            Array.from(navTabs.children).forEach((c) => (c.style.background = ""));
            btn.style.background = "rgba(0, 123, 255, 0.6)";

            resetFeed();
            if (state.cumSelectedTypes.length === 1) {
              state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/posts?type=${state.cumSelectedTypes[0]}`;
            } else {
              state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/posts`;
            }
            fetchPosts();
          });

          dropdown.appendChild(row);
        });

        document.body.appendChild(dropdown);

        const navEl = document.getElementById("nav");
        if (navEl) navEl.classList.add("visible");

        function outsideClose(ev) {
          if (!dropdown.contains(ev.target) && ev.target !== btn) {
            dropdown.remove();
            document.removeEventListener("mousedown", outsideClose);
            if (navEl) updateNavVisibility();
          }
        }
        setTimeout(() => document.addEventListener("mousedown", outsideClose), 0);
        return;
      }

      if (tab === "Linked Accounts") {
        const existingDropdown = document.getElementById("linked-accounts-dropdown");
        if (existingDropdown) {
          existingDropdown.remove();
          return;
        }

        const dropdown = document.createElement("div");
        dropdown.id = "linked-accounts-dropdown";

        const btnRect = btn.getBoundingClientRect();
        dropdown.style.cssText = `
          position: fixed;
          top: ${btnRect.bottom + 6}px;
          left: ${btnRect.left + btnRect.width / 2}px;
          transform: translateX(-50%);
          background: rgba(0,0,0,0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 14px;
          padding: 8px;
          display: flex; flex-direction: column; gap: 6px;
          min-width: 180px;
          z-index: 1100;
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        `;

        if (creator.allPlatforms && creator.allPlatforms.length > 1) {
          creator.allPlatforms.forEach((p) => {
            const isActive = p.service === creator.service && p.id === creator.id;
            const row = document.createElement("button");
            row.style.cssText = `
              display:flex; align-items:center; gap:10px;
              padding: 8px 12px; border-radius: 10px; border: none;
              background: ${isActive ? "rgba(0,123,255,0.6)" : "rgba(255,255,255,0.08)"};
              color: #fff; font-size: 0.9rem; font-weight: ${isActive ? "bold" : "normal"};
              cursor: pointer; text-align: left; width: 100%;
              transition: background 0.15s;
            `;
            row.onmouseenter = () => {
              if (!isActive) row.style.background = "rgba(255,255,255,0.18)";
            };
            row.onmouseleave = () => {
              if (!isActive) row.style.background = "rgba(255,255,255,0.08)";
            };

            const icon = document.createElement("img");
            icon.src = `icons/${p.service}.svg`;
            icon.style.cssText = "width:20px; height:20px; object-fit:contain; flex-shrink:0;";
            icon.onerror = () => (icon.style.display = "none");

            const labelWrap = document.createElement("span");
            labelWrap.style.cssText = "display:flex; flex-direction:column; line-height:1.3;";
            labelWrap.innerHTML = `<span>${p.service.charAt(0).toUpperCase() + p.service.slice(1)}</span><span style="opacity:0.6;font-size:0.78rem;">${p.name}</span>`;

            row.appendChild(icon);
            row.appendChild(labelWrap);
            if (isActive) {
              const check = document.createElement("span");
              check.textContent = "✓";
              check.style.marginLeft = "auto";
              row.appendChild(check);
            }

            row.addEventListener("click", (ev) => {
              ev.stopPropagation();
              dropdown.remove();
              document.removeEventListener("mousedown", outsideClose);
              updateNavVisibility();
              resetFeed();
              state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${p.service}/user/${p.id}/posts`;
              state.currentFeedCreatorName = p.name;
              updateNavTabs({ ...p, allPlatforms: creator.allPlatforms });
              fetchPosts();
            });

            dropdown.appendChild(row);
          });
        }

        document.body.appendChild(dropdown);

        const navEl = document.getElementById("nav");
        if (navEl) navEl.classList.add("visible");

        function outsideClose(ev) {
          if (!dropdown.contains(ev.target) && ev.target !== btn) {
            dropdown.remove();
            document.removeEventListener("mousedown", outsideClose);
            if (navEl) updateNavVisibility();
          }
        }
        setTimeout(() => document.addEventListener("mousedown", outsideClose), 0);
        return;
      }

      Array.from(navTabs.children).forEach((c) => (c.style.background = ""));
      btn.style.background = "rgba(0, 123, 255, 0.6)";

      resetFeed();
      if (tab === "Fancards" && state.currentSite === "cum") {
        state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/posts?type=fancards`;
        fetchPosts();
      } else if (tab === "Posts" || tab === "DMs" || tab === "Announcements" || tab === "Fancards") {
        state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/${tab.toLowerCase()}`;
        fetchPosts();
      } else if (tab === "Similar Creators" || tab === "Similar Artists") {
        const isMobile = window.innerWidth <= 600 || window.innerHeight <= 500;
        const placeholderPadding = isMobile ? "120px 20px 40px 20px" : "80px 20px 40px 20px";

        feed.innerHTML = `<div style="text-align:center; padding: ${placeholderPadding}; color: #aaa; font-size: 1.2rem; width: 100%; box-sizing: border-box;">Loading similar creators...</div>`;

        const renderCreators = (similarCreators) => {
          feed.innerHTML = "";
          if (similarCreators && similarCreators.length > 0) {
            const grid = document.createElement("div");
            grid.className = "creators-grid";
            const isMobile = window.innerWidth <= 600 || window.innerHeight <= 500;
            const pad = isMobile ? "120px 20px 60px 20px" : "80px 20px 60px 20px";
            grid.style.cssText = `padding: ${pad}; width: 100%; box-sizing: border-box;`;
            similarCreators.forEach((c) => {
              c.allPlatforms = [c];
              const card = buildCreatorCard(c);
              grid.appendChild(card);
            });
            feed.appendChild(grid);
          } else {
            const placeholder = document.createElement("div");
            placeholder.style.cssText = `text-align:center; padding: ${placeholderPadding}; color: #aaa; font-size: 1.2rem; width: 100%; box-sizing: border-box;`;
            placeholder.textContent = `No similar creators found for this profile.`;
            feed.appendChild(placeholder);
          }
        };

        if (state.currentSite === "kemono" || state.currentSite === "pawchive") {
          const endpoint = `${PROXY_URL}/${state.currentSite}/${creator.service}/user/${creator.id}/recommended`;
          fetch(endpoint)
            .then((res) => {
              if (!res.ok) throw new Error("Proxy error or not found");
              return res.text();
            })
            .then((html) => {
              const parser = new DOMParser();
              const doc = parser.parseFromString(html, "text/html");
              const cards = doc.querySelectorAll(".user-card");
              const scrapedCreators = [];
              cards.forEach((card) => {
                const nameEl = card.querySelector(".user-card__name");
                const serviceId = card.getAttribute("data-service");
                const userId = card.getAttribute("data-id");
                if (serviceId && userId && nameEl) {
                  let favoritedCount = 0;
                  if (state.allCreators) {
                    for (const cObj of state.allCreators) {
                      if (cObj.allPlatforms) {
                        const match = cObj.allPlatforms.find((p) => p.id === userId && p.service === serviceId);
                        if (match) {
                          favoritedCount = match.favorited || match.bookmarked || 0;
                          break;
                        }
                      }
                    }
                  }

                  scrapedCreators.push({
                    id: userId,
                    name: nameEl.textContent.trim(),
                    service: serviceId,
                    favorited: favoritedCount,
                  });
                }
              });
              renderCreators(scrapedCreators);
            })
            .catch((err) => {
              feed.innerHTML = "";
              const placeholder = document.createElement("div");
              placeholder.style.cssText = `text-align:center; padding: ${placeholderPadding}; color: #aaa; font-size: 1.2rem; width: 100%; box-sizing: border-box;`;
              placeholder.textContent = `Similar artists fetch failed. Ensure your paw-worker proxy supports routing HTML pages.`;
              feed.appendChild(placeholder);
            });
          return;
        }

        const endpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/similar`;
        fetch(endpoint)
          .then((res) => {
            if (!res.ok) throw new Error("Not found");
            return res.json();
          })
          .then((data) => {
            const similarCreators = data.creators || (Array.isArray(data) ? data : null);
            renderCreators(similarCreators);
          })
          .catch((err) => {
            feed.innerHTML = "";
            const placeholder = document.createElement("div");
            placeholder.style.cssText = `text-align:center; padding: ${placeholderPadding}; color: #aaa; font-size: 1.2rem; width: 100%; box-sizing: border-box;`;
            placeholder.textContent = `Similar artists are not yet supported for this source.`;
            feed.appendChild(placeholder);
          });
      } else {
        const isMobile = window.innerWidth <= 600 || window.innerHeight <= 500;
        const placeholderPadding = isMobile ? "120px 20px 40px 20px" : "80px 20px 40px 20px";
        const placeholder = document.createElement("div");
        placeholder.style.cssText = `text-align:center; padding: ${placeholderPadding}; color: #aaa; font-size: 1.2rem; width: 100%; box-sizing: border-box;`;
        placeholder.textContent = `${tab} are not yet supported by Paw Reader.`;
        feed.appendChild(placeholder);
      }
    });

    if (
      (state.currentSite === "kemono" || state.currentSite === "pawchive") &&
      (tab === "DMs" || tab === "Announcements" || tab === "Fancards" || tab === "Linked Accounts")
    ) {
      if (tab === "Linked Accounts") {
        const cacheKey = `_linksFetched`;
        if (creator[cacheKey] !== undefined) {
          btn.style.display = creator.allPlatforms && creator.allPlatforms.length > 1 ? "flex" : "none";
        } else {
          fetch(`${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/links`)
            .then(res => res.ok ? res.json() : [])
            .then(arr => {
              if (Array.isArray(arr) && arr.length > 0) {
                creator.allPlatforms = creator.allPlatforms || [{ id: creator.id, service: creator.service, name: creator.name }];
                
                arr.forEach(link => {
                  const exists = creator.allPlatforms.find(p => p.id === link.id && p.service === link.service);
                  if (!exists) {
                    creator.allPlatforms.push({
                      id: link.id,
                      service: link.service,
                      name: link.name || link.id
                    });
                  }
                });
              }
              creator[cacheKey] = true;
              btn.style.display = creator.allPlatforms && creator.allPlatforms.length > 1 ? "flex" : "none";
            })
            .catch(() => {
              creator[cacheKey] = true;
            });
        }
      } else {
        const cacheKey = `_has${tab}`;

        if (creator[cacheKey] !== undefined) {
          btn.style.display = creator[cacheKey] ? "" : "none";
        } else {
          btn.style.display = "none";
          
          if (state.currentSite === "pawchive" && tab === "DMs") {
            fetch(`${PROXY_URL}/pawchive/${creator.service}/user/${creator.id}/dms`)
              .then(res => {
                if (!res.ok) throw new Error("No DMs found or blocked");
                return res.text();
              })
              .then(html => {
                if (html.includes('<article') || html.includes('post-card')) {
                  btn.style.display = "";
                  creator[cacheKey] = true;
                } else {
                  creator[cacheKey] = false;
                }
              })
              .catch(() => {
                creator[cacheKey] = false;
              });
          } else {
            fetch(`${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/${tab.toLowerCase()}?limit=1`)
              .then((res) => res.json())
              .then((data) => {
                const arr = data.posts || data.announcements || data.dms || data.fancards || (Array.isArray(data) ? data : []);
                if (arr.length > 0) {
                  btn.style.display = "";
                  creator[cacheKey] = true;
                } else {
                  creator[cacheKey] = false;
                }
              })
              .catch(() => {
                creator[cacheKey] = false;
              });
          }
        }
      }
    }

    navTabs.appendChild(btn);
  });
}

export function wrapCarousel(carousel, direction) {
  const w = window.innerWidth;
  let target = 0;
  if (direction === "end") {
    target = carousel.scrollWidth - carousel.clientWidth;
  }
  carousel.dataset.targetScroll = target;
  carousel.dataset.scrollDir = direction === "end" ? "left" : "right";
  carousel.style.scrollSnapType = "none";
  carousel.scrollTo({ left: target, behavior: "auto" });
}

export function showView(viewElement, showNav = true) {
  [welcomeScreen, creatorsView, feedView].forEach((v) => {
    if (v) v.classList.remove("active");
  });
  if (viewElement) viewElement.classList.add("active");

  if (showNav && nav) nav.classList.remove("hidden");
  else if (nav) nav.classList.add("hidden");

  const navTabs = document.getElementById("nav-tabs");

  if (viewElement === feedView) {
    if (nav) nav.classList.add("auto-hide");
    state.navManualVisible = false;
    if (navInfo) navInfo.classList.remove("hidden");
    if (navTabs) {
      if (state.currentFeedCreatorName) {
        navTabs.classList.remove("hidden");
      } else {
        navTabs.classList.add("hidden");
      }
    }
    updateNavVisibility();
  } else {
    state.navManualVisible = false;
    if (nav) {
      nav.classList.remove("auto-hide");
      nav.classList.remove("visible");
    }
    if (navTabs) navTabs.classList.add("hidden");
    if (navInfo) navInfo.classList.add("hidden");
  }
}