# -*- coding: utf-8 -*-
"""用本机存储的 GitHub 凭据创建仓库并开启 Pages。"""
import json, os, sys, urllib.request, urllib.error

TOKEN = os.environ["GITHUB_TOKEN"]
API = "https://api.github.com"


def req(method, path, payload=None, accept="application/vnd.github+json"):
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(API + path, data=data, method=method)
    r.add_header("Authorization", "Bearer " + TOKEN)
    r.add_header("Accept", accept)
    r.add_header("X-GitHub-Api-Version", "2022-11-28")
    r.add_header("User-Agent", "feiyi-deploy")
    if data:
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")


if __name__ == "__main__":
    code, me = req("GET", "/user")
    print("user:", code, me.get("login"), me.get("name"))
    if code != 200:
        sys.exit(1)
    login = me["login"]
    name = sys.argv[1] if len(sys.argv) > 1 else "feiyi-spatial"
    code, repo = req("GET", f"/repos/{login}/{name}")
    if code == 404:
        code, repo = req("POST", "/user/repos", {
            "name": name,
            "description": "山河入谱：国家级非物质文化遗产代表性项目的空间人文可视化",
            "homepage": f"https://{login}.github.io/{name}/",
            "private": False,
            "has_issues": True,
            "has_wiki": False,
        })
        print("create:", code, repo.get("full_name"), repo.get("html_url"))
    else:
        print("exists:", code, repo.get("full_name"), repo.get("html_url"))
    print("CLONE_URL=" + repo.get("clone_url", ""))
    print("PAGES_URL=" + f"https://{login}.github.io/{name}/")
