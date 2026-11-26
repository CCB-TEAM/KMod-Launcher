package team.ccb.kmod_launcher

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.OpenableColumns
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import android.webkit.WebView
import team.ccb.kmod_launcher.installer.Installer
import org.json.JSONObject
import java.io.File

@InvokeArg
class PkgArgs {
    var pkg: String = ""
}

@InvokeArg
class UrlArgs {
    var url: String = ""
}

@InvokeArg
class PathArgs {
    var path: String = ""
}

@InvokeArg
class InspectArgs {
    var path: String = ""
    var split: Boolean = false
}

@InvokeArg
class StartArgs {
    var pkg: String = ""
    var label: String = ""
    var path: String = ""
    var flavor: String = "release"
}

@InvokeArg
class PickArgs {
    var exts: Array<String> = arrayOf()
}

/**
 * Things the Rust side cannot do by itself: the "all files access" permission, launching the game,
 * the system file picker (picked files are copied to the app cache so Rust gets real paths)
 * and handing an APK to the system installer.
 */
@TauriPlugin
class KModPlugin(private val activity: Activity) : Plugin(activity) {

    override fun load(webView: WebView) {
        Installer.register(activity.applicationContext)
    }

    // Android 11+: "all files access". Older: the ordinary storage permission, which has to be asked for at run time too.
    private fun hasAccess(): Boolean =
        if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
        else activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

    private var askedStorage = false
    private var askedApps = false

    // Many Chinese system builds (vivo, Xiaomi, OPPO…) add a runtime permission for the installed app list; without it the
    // installer cannot find the game. Where the system does not define it, there is nothing to ask for.
    private val appListPermission = "com.android.permission.GET_INSTALLED_APPS"

    private fun hasAppList(): Boolean {
        try {
            activity.packageManager.getPermissionInfo(appListPermission, 0)
        } catch (e: PackageManager.NameNotFoundException) {
            return true
        }
        return activity.checkSelfPermission(appListPermission) == PackageManager.PERMISSION_GRANTED
    }

    @Command
    fun requestApps(invoke: Invoke) {
        activity.runOnUiThread {
            // after a refusal that stops the dialog from appearing: send the player to the app's settings page
            if (askedApps && !activity.shouldShowRequestPermissionRationale(appListPermission)) {
                activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.packageName)))
            } else {
                askedApps = true
                activity.requestPermissions(arrayOf(appListPermission), 4712)
            }
        }
        invoke.resolve()
    }

    @Command
    fun info(invoke: Invoke) {
        val args = invoke.parseArgs(PkgArgs::class.java)
        val out = JSObject()
        out.put("access", hasAccess())
        out.put("apps", hasAppList())
        try {
            val p = activity.packageManager.getPackageInfo(args.pkg, 0)
            out.put("installed", true)
            out.put("version", p.versionName ?: "")
        } catch (e: Exception) {
            out.put("installed", false)
            out.put("version", "")
        }
        invoke.resolve(out)
    }

    @Command
    fun requestAccess(invoke: Invoke) {
        if (Build.VERSION.SDK_INT < 30) {
            val write = Manifest.permission.WRITE_EXTERNAL_STORAGE
            activity.runOnUiThread {
                // after "don't ask again" the dialog no longer appears: send the player to the app's settings page
                if (askedStorage && !activity.shouldShowRequestPermissionRationale(write)) {
                    activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.packageName)))
                } else {
                    askedStorage = true
                    activity.requestPermissions(arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, write), 4711)
                }
            }
            invoke.resolve()
            return
        }
        try {
            val i = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + activity.packageName))
            activity.startActivity(i)
        } catch (e: Exception) {
            try {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
            } catch (e2: Exception) {
                invoke.reject("打不开系统的权限设置：" + e2.message)
                return
            }
        }
        invoke.resolve()
    }

    @Command
    fun launch(invoke: Invoke) {
        val args = invoke.parseArgs(PkgArgs::class.java)
        val i = activity.packageManager.getLaunchIntentForPackage(args.pkg)
        if (i == null) {
            invoke.reject("没有安装 " + args.pkg)
            return
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(i)
        invoke.resolve()
    }

    @Command
    fun openUrl(invoke: Invoke) {
        val args = invoke.parseArgs(UrlArgs::class.java)
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(args.url)))
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "打不开链接")
        }
    }

    /** Hands a downloaded launcher update (inside the app cache) to the system installer. */
    @Command
    fun installApk(invoke: Invoke) {
        val args = invoke.parseArgs(PathArgs::class.java)
        try {
            val file = File(args.path).canonicalFile
            if (!file.path.startsWith(activity.cacheDir.canonicalPath + File.separator) || !file.isFile) {
                invoke.reject("安装包位置不对")
                return
            }
            if (!Installer.canInstall(activity)) {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName)))
                invoke.reject("请先允许 KMod Launcher 安装应用，返回后再点一次“更新”")
                return
            }
            val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file)
            val i = Intent(Intent.ACTION_VIEW)
            i.setDataAndType(uri, "application/vnd.android.package-archive")
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(i)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("打不开系统安装器：" + e.message)
        }
    }

    // ---- file picker ----

    private var wantedExts: List<String> = listOf()

    @Command
    fun pick(invoke: Invoke) {
        val args = invoke.parseArgs(PickArgs::class.java)
        wantedExts = args.exts.map { it.lowercase() }
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT)
        i.addCategory(Intent.CATEGORY_OPENABLE)
        i.type = "*/*"
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        startActivityForResult(invoke, i, "pickResult")
    }

    private fun displayName(uri: Uri): String {
        activity.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0 && c.moveToFirst()) return c.getString(idx)
        }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "file"
    }

    @ActivityCallback
    fun pickResult(invoke: Invoke, result: ActivityResult) {
        val out = JSObject()
        val files = JSArray()
        if (result.resultCode == Activity.RESULT_OK) {
            val data = result.data
            val uris = ArrayList<Uri>()
            data?.data?.let { uris.add(it) }
            data?.clipData?.let { cd ->
                for (n in 0 until cd.itemCount) uris.add(cd.getItemAt(n).uri)
            }
            val dir = File(activity.cacheDir, "picked")
            dir.deleteRecursively()
            dir.mkdirs()
            for (uri in uris) {
                // keep only a plain file name (the picker gives a display name, not a path)
                val name = displayName(uri).substringAfterLast('/').substringAfterLast('\\')
                val ext = name.substringAfterLast('.', "").lowercase()
                if (wantedExts.isNotEmpty() && ext !in wantedExts) continue
                try {
                    val dest = File(dir, name)
                    activity.contentResolver.openInputStream(uri)?.use { input ->
                        dest.outputStream().use { input.copyTo(it) }
                    }
                    files.put(dest.absolutePath)
                } catch (e: Exception) {
                }
            }
        }
        out.put("files", files)
        invoke.resolve(out)
    }

    // ---- built-in kmod installer (see installer/Installer.java) ----

    private fun obj(j: JSONObject): JSObject {
        val o = JSObject()
        val it = j.keys()
        while (it.hasNext()) {
            val k = it.next()
            o.put(k, j.get(k))
        }
        return o
    }

    @Command
    fun installerInfo(invoke: Invoke) {
        val o = JSObject()
        o.put("flavors", Installer.flavors(activity))
        o.put("canInstall", Installer.canInstall(activity))
        invoke.resolve(o)
    }

    @Command
    fun installerAllowInstall(invoke: Invoke) {
        try {
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName)))
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("打不开系统设置：" + e.message)
        }
    }

    @Command
    fun installerScan(invoke: Invoke) {
        Thread {
            try {
                val o = JSObject()
                o.put("apps", Installer.scan(activity))
                invoke.resolve(o)
            } catch (e: Throwable) {
                invoke.reject("查找失败：" + e)
            }
        }.start()
    }

    @Command
    fun installerInspect(invoke: Invoke) {
        val args = invoke.parseArgs(InspectArgs::class.java)
        Thread {
            try {
                invoke.resolve(obj(Installer.inspect(args.path, args.split)))
            } catch (e: Throwable) {
                invoke.reject("检查失败：" + e)
            }
        }.start()
    }

    @Command
    fun installerStart(invoke: Invoke) {
        val args = invoke.parseArgs(StartArgs::class.java)
        if (!Installer.canInstall(activity)) {
            invoke.reject("请先允许 KMod Launcher 安装其他应用")
            return
        }
        Installer.start(activity.applicationContext, args.pkg, args.label, args.path, args.flavor)
        invoke.resolve()
    }

    @Command
    fun installerStatus(invoke: Invoke) {
        invoke.resolve(obj(Installer.status()))
    }

    @Command
    fun installerUninstall(invoke: Invoke) {
        Installer.uninstall(activity)
        invoke.resolve()
    }

    @Command
    fun installerProceed(invoke: Invoke) {
        Installer.proceed(activity.applicationContext)
        invoke.resolve()
    }

    @Command
    fun installerReset(invoke: Invoke) {
        Installer.reset()
        invoke.resolve()
    }
}

