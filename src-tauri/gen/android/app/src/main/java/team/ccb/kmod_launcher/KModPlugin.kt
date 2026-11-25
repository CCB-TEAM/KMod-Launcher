package team.ccb.kmod_launcher

import android.app.Activity
import android.content.Intent
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

    private fun hasAccess(): Boolean =
        if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager() else true

    @Command
    fun info(invoke: Invoke) {
        val args = invoke.parseArgs(PkgArgs::class.java)
        val out = JSObject()
        out.put("access", hasAccess())
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

    @Command
    fun installApk(invoke: Invoke) {
        val args = invoke.parseArgs(PathArgs::class.java)
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            try {
                val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName))
                activity.startActivity(i)
            } catch (e: Exception) {
            }
            invoke.reject("请先在系统设置里允许 KMod Launcher 安装其他应用，然后再点一次")
            return
        }
        try {
            val file = File(args.path)
            val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file)
            val i = Intent(Intent.ACTION_VIEW)
            i.setDataAndType(uri, "application/vnd.android.package-archive")
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(i)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("无法启动安装器：" + e.message)
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
}
